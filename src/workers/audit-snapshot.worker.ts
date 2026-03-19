import fs from 'fs';
import path from 'path';
import { prisma } from '../db/client';
import { logger } from '../utils/logger';

const SNAPSHOT_DIR = path.resolve(process.cwd(), 'sandbox', 'audit_snapshots');
const CURSOR_FILE = path.join(SNAPSHOT_DIR, '.cursor');

export class AuditSnapshotWorker {
    private isRunning = false;
    private intervalDurationMs: number;

    constructor(intervalDurationMs: number = 1000 * 60 * 15) { // Default 15m
        this.intervalDurationMs = intervalDurationMs;
    }

    private intervalId?: NodeJS.Timeout;

    public async start() {
        logger.info(`[Audit Worker] Starting background sweep for Audit Recovery Snapshots every ${this.intervalDurationMs}ms`);
        
        try {
            await fs.promises.access(SNAPSHOT_DIR);
        } catch {
            await fs.promises.mkdir(SNAPSHOT_DIR, { recursive: true });
        }

        this.intervalId = setInterval(() => this.runSweep(), this.intervalDurationMs);
        
        // Execute an initial sweep on boot
        setTimeout(() => this.runSweep(), 2000);
    }

    public stop() {
        if (this.intervalId) clearInterval(this.intervalId);
        logger.info("[Audit Worker] Stopped.");
    }

    private async getLastProcessedId(): Promise<string> {
        try {
            await fs.promises.access(CURSOR_FILE);
            const cursorStr = await fs.promises.readFile(CURSOR_FILE, 'utf-8');
            return cursorStr.trim() || '';
        } catch (error) {
            return '';
        }
    }

    private async updateCursor(lastId: string) {
        await fs.promises.writeFile(CURSOR_FILE, lastId);
    }

    private async runSweep() {
        if (this.isRunning) return;
        this.isRunning = true;

        try {
            const lastProcessedId = await this.getLastProcessedId();
            
            // Query new audit logs using id cursor (avoids timestamp-boundary record drops)
            const whereClause = lastProcessedId ? { id: { gt: lastProcessedId } } : {};
            const logsToExport = await prisma.auditLog.findMany({
                where: whereClause,
                orderBy: {
                    id: 'asc'
                },
                take: 1000
            });

            if (logsToExport.length === 0) {
                this.isRunning = false;
                return;
            }

            // Group by Day for rotation (e.g. audit_2024-03-10.jsonl)
            const groupedByDate: Record<string, typeof logsToExport> = {};
            
            for (const log of logsToExport) {
                const dateKey = log.timestamp.toISOString().split('T')[0];
                if (!groupedByDate[dateKey]) groupedByDate[dateKey] = [];
                groupedByDate[dateKey].push(log);
            }

            for (const [dateKey, logs] of Object.entries(groupedByDate)) {
                const filePath = path.join(SNAPSHOT_DIR, `audit_${dateKey}.jsonl`);
                
                // Convert to JSONL string
                const jsonlData = logs.map(l => JSON.stringify(l)).join('\n') + '\n';
                
                // Append securely
                await fs.promises.appendFile(filePath, jsonlData);
                
                logger.debug(`[Audit Worker] Wrote ${logs.length} logs to ${filePath}`);
            }

            // Update cursor to the id of the last exported record
            const lastExportedId = logsToExport[logsToExport.length - 1].id;
            await this.updateCursor(lastExportedId);
            
            logger.info(`[Audit Worker] Successfully snapshot exported ${logsToExport.length} immutable records.`);
            
        } catch (error: any) {
            logger.error('[Audit Worker] Snapshot sweep failed', { error: error.message });
        } finally {
            this.isRunning = false;
        }
    }
}
