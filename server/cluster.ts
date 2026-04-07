/**
 * Cluster Mode — Multi-worker for Node.js
 * Uses all available CPU cores for maximum throughput.
 * Primary worker handles scheduled jobs; all workers handle HTTP.
 * 
 * Usage: NODE_ENV=production node server/cluster.js
 * Falls back to single-process if CLUSTER_WORKERS=1 or in dev mode.
 */

import cluster from 'cluster';
import os from 'os';

const WORKER_COUNT = parseInt(process.env.CLUSTER_WORKERS || '0', 10) || Math.min(os.cpus().length, 8);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (cluster.isPrimary && IS_PRODUCTION && WORKER_COUNT > 1) {
    console.log(`[Cluster] Primary ${process.pid} starting ${WORKER_COUNT} workers...`);

    // Fork workers
    for (let i = 0; i < WORKER_COUNT; i++) {
        const worker = cluster.fork({ WORKER_ID: String(i), IS_PRIMARY_WORKER: i === 0 ? '1' : '0' });
        console.log(`[Cluster] Worker ${worker.process.pid} (id=${i}) spawned`);
    }

    // Handle worker crashes — restart with backoff
    let restartCount = 0;
    const MAX_RESTARTS = WORKER_COUNT * 3;
    const RESTART_WINDOW = 60000; // 1 minute
    let windowStart = Date.now();

    cluster.on('exit', (worker, code, signal) => {
        console.error(`[Cluster] Worker ${worker.process.pid} died (code=${code}, signal=${signal})`);

        // Reset counter every minute
        if (Date.now() - windowStart > RESTART_WINDOW) {
            restartCount = 0;
            windowStart = Date.now();
        }

        restartCount++;
        if (restartCount > MAX_RESTARTS) {
            console.error(`[Cluster] Too many restarts (${restartCount}/${MAX_RESTARTS}) in window. Stopping.`);
            process.exit(1);
        }

        // Restart with delay
        const delay = Math.min(1000 * restartCount, 10000);
        console.log(`[Cluster] Restarting worker in ${delay}ms...`);
        setTimeout(() => {
            const workerId = (worker as any).env?.WORKER_ID || '0';
            cluster.fork({ WORKER_ID: workerId, IS_PRIMARY_WORKER: workerId === '0' ? '1' : '0' });
        }, delay);
    });

    // Graceful shutdown
    const shutdown = () => {
        console.log('[Cluster] Shutting down all workers...');
        for (const id in cluster.workers) {
            cluster.workers[id]?.send('shutdown');
            cluster.workers[id]?.kill('SIGTERM');
        }
        setTimeout(() => process.exit(0), 10000);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Health check logging
    setInterval(() => {
        const workers = Object.keys(cluster.workers || {}).length;
        console.log(`[Cluster] Health: ${workers}/${WORKER_COUNT} workers active`);
    }, 300000); // 5 min

} else {
    // Single worker or dev mode — just run the server
    if (cluster.isWorker) {
        console.log(`[Worker ${process.pid}] Starting (id=${process.env.WORKER_ID}, primary=${process.env.IS_PRIMARY_WORKER})`);
    }

    // Dynamic import of the main server
    import('./index.js');
}
