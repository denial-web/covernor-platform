import { WorkflowCoordinator } from './core/workflow/coordinator.service';
import { prisma } from './db/client';
import chalk from 'chalk';

async function generateDemoTask(objective: string) {
  const task = await prisma.task.create({
    data: {
      objective,
      status: 'PENDING'
    }
  });
  return task;
}

async function waitForTaskCompletion(taskId: string): Promise<any> {
  const maxWait = 30000; // 30 seconds
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const t = await prisma.task.findUnique({ where: { id: taskId } });
    if (t && (t.status === 'COMPLETED' || t.status === 'FAILED' || t.status === 'AWAITING_HUMAN')) {
      return t;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error("Timeout waiting for task completion. Make sure Redis is running for BullMQ!");
}

async function runDemo() {
  console.log(chalk.bold.blue('======================================================'));
  console.log(chalk.bold.blue('      Covernor Platform : P0 Launch Demo     '));
  console.log(chalk.bold.blue('======================================================\n'));
  console.log(chalk.yellow('Note: BullMQ implementation requires a local Redis instance running on port 6379.\n'));

  const coordinator = WorkflowCoordinator.getInstance();

  try {
    // ---------------------------------------------------------
    // SCENARIO 1: Safe HTTP Request
    // ---------------------------------------------------------
    console.log(chalk.bold.yellow('\n▶ SCENARIO 1: Basic HTTP Fetch (Expected: ALLOWED)'));
    const task1 = await generateDemoTask('Fetch the current Bitcoin price from API: https://api.coindesk.com/v1/bpi/currentprice.json');
    await coordinator.processTask(task1.id, task1.objective, { source: 'CLI_DEMO' });
    
    const finalTask1 = await waitForTaskCompletion(task1.id);
    console.log(finalTask1?.status === 'COMPLETED' ? chalk.green('✔ Scenario 1 Passed\n') : chalk.red('✘ Scenario 1 Failed\n'));


    // ---------------------------------------------------------
    // SCENARIO 2: Dangerous DB Modification triggers Suggest-and-Retry
    // ---------------------------------------------------------
    console.log(chalk.bold.yellow('\n▶ SCENARIO 2: Disallowed Operation with Suggest-and-Retry (Expected: REJECT -> RETRY -> ALLOWED)'));
    const task2 = await generateDemoTask('Delete all test users from the database.');
    await coordinator.processTask(task2.id, task2.objective, { source: 'CLI_DEMO' });
    
    const finalTask2 = await waitForTaskCompletion(task2.id);
    console.log(finalTask2?.status === 'COMPLETED' ? chalk.green('✔ Scenario 2 Passed\n') : chalk.red('✘ Scenario 2 Failed\n'));

  } catch (err) {
    console.error(chalk.red('Demo encountered a fatal error:'), err);
  } finally {
    await prisma.$disconnect();
    console.log(chalk.bold.blue('======================================================'));
    console.log(chalk.bold.blue('                     DEMO COMPLETE                    '));
    console.log(chalk.bold.blue('======================================================'));
    process.exit(0); // Force exit to close BullMQ Redis connections
  }
}

runDemo();
