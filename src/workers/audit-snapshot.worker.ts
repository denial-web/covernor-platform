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

    private async getLastCursor(): Promise<{ timestamp: Date; id: string } | null> {
        try {
            await fs.promises.access(CURSOR_FILE);
            const cursorStr = await fs.promises.readFile(CURSOR_FILE, 'utf-8');
            const parsed = JSON.parse(cursorStr.trim());
            if (parsed.timestamp && parsed.id) {
                return { timestamp: new Date(parsed.timestamp), id: parsed.id };
            }
        } catch (error) {
            // File doesn't exist or invalid JSON
        }
        return null;
    }

    private async updateCursor(timestamp: Date, id: string) {
        await fs.promises.writeFile(CURSOR_FILE, JSON.stringify({ timestamp: timestamp.toISOString(), id }));
    }

    private async runSweep() {
        if (this.isRunning) return;
        this.isRunning = true;

        try {
            const cursor = await this.getLastCursor();
            
            // Keyset pagination: fetch records strictly after (timestamp, id) cursor
            const whereClause = cursor
                ? {
                    OR: [
                        { timestamp: { gt: cursor.timestamp } },
                        { timestamp: cursor.timestamp, id: { gt: cursor.id } }
                    ]
                  }
                : {};
            const logsToExport = await prisma.auditLog.findMany({
                where: whereClause,
                orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
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

            const lastExported = logsToExport[logsToExport.length - 1];
            await this.updateCursor(lastExported.timestamp, lastExported.id);
            
            logger.info(`[Audit Worker] Successfully snapshot exported ${logsToExport.length} immutable records.`);
            
        } catch (error: any) {
            logger.error('[Audit Worker] Snapshot sweep failed', { error: error.message });
        } finally {
            this.isRunning = false;
        }
    }
}
