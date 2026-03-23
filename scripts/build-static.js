const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const apiPath = path.join(__dirname, '../src/app/api');
const backupPath = path.join(__dirname, '../src/app/_api');

console.log('--- Preparing static build ---');

try {
    if (fs.existsSync(apiPath)) {
        console.log('Moving API folder to backup to bypass export limitations...');
        fs.renameSync(apiPath, backupPath);
    }

    console.log('Running Next.js build with BUILD_EXTRACT=true...');
    // We use process.env to set the variable for the current process and its children
    process.env.BUILD_EXTRACT = 'true';
    execSync('npx next build', { stdio: 'inherit' });

    console.log('Build successful.');
} catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
} finally {
    if (fs.existsSync(backupPath)) {
        console.log('Restoring API folder...');
        if (fs.existsSync(apiPath)) {
            // This shouldn't happen, but just in case
            console.warn('API folder already exists, merging or cleaning up...');
        }
        fs.renameSync(backupPath, apiPath);
    }
}
