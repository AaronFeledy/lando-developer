/**
 * @fileoverview This script sets up and manages the repositories for the Lando development environment.
 * It clones or updates a predefined list of Lando-related repositories, updates their submodules,
 * and runs npm install in the root directory.
 */

const fs = require('fs-extra');
const simpleGit = require('simple-git');
const path = require('path');
const { spawn } = require('child_process');
const util = require('util');

// Add this line to get the npm_lifecycle_event
const npmLifecycleEvent = process.env.npm_lifecycle_event;

const SKIP_SETUP_ENV = 'SKIP_SETUP';

// Add this line to import the repos from the JSON file
const repos = require('./repos.json');

/**
 * Sets up all repositories and runs npm install
 * @async
 * @function setupRepos
 * @throws {Error} If npm install fails
 */
async function setupRepos() {
  // Exit early if SKIP_SETUP environment variable is set
  if (process.env[SKIP_SETUP_ENV]) {
    console.log('SKIP_SETUP environment variable detected. Skipping setup.');
    return;
  }

  const reposDir = path.join(__dirname, '..', 'repos');
  const notifications = [];

  // Ensure the repos directory exists
  await fs.ensureDir(reposDir);

  for (const repo of repos) {
    const repoPath = path.join(reposDir, repo.name);
    
    console.log(`Setting up ${repo.name}...`);

    try {
      if (await fs.pathExists(repoPath)) {
        console.log(`${repo.name} already exists. Checking for changes...`);
        const git = simpleGit(repoPath);
        
        // Check if there are local changes
        const status = await git.status();
        
        if (status.modified.includes('package-lock.json')) {
          console.log(`Resetting package-lock.json in ${repo.name}...`);
          await git.checkout(['--', 'package-lock.json']);
          const notification = `package-lock.json was reset in ${repo.name}. You may need to redo any package updates.`;
          console.warn(notification);
          notifications.push(notification);
        } else if (status.modified.length > 0 || status.not_added.length > 0) {
          console.log(`Local changes detected in ${repo.name}. Stashing changes...`);
          await git.stash(['save', `Automatic stash by setup script`]);
        }
        
        console.log(`Pulling latest changes for ${repo.name}...`);
        await git.pull();
        
        // Check if there was a stash and try to apply it
        const stashList = await git.stashList();
        if (stashList.all.length > 0) {
          console.log(`Attempting to reapply local changes for ${repo.name}...`);
          try {
            await git.stash(['pop']);
            console.log(`Successfully reapplied local changes for ${repo.name}.`);
          } catch (stashError) {
            const notification = `Merge conflict when reapplying changes in ${repo.name}. Please resolve conflicts manually.`;
            console.warn(notification);
            notifications.push(notification);
          }
        }
      } else {
        console.log(`Cloning ${repo.name}...`);
        await simpleGit().clone(repo.url, repoPath);
      }

      console.log(`Updating submodules for ${repo.name}...`);
      const git = simpleGit(repoPath);
      await git.submoduleUpdate(['--init', '--recursive']);
    } catch (error) {
      console.error(`Error setting up ${repo.name}:`, error.message);
      const notification = `Error in ${repo.name}: ${error.message}. Please check and update manually if needed.`;
      console.log(notification);
      notifications.push(notification);
      continue;
    }
  }

  console.log('All repositories have been processed.');

  console.log('Running npm install with SKIP_SETUP flag...');

  const npmInstall = spawn('npm', ['install'], { 
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env, [SKIP_SETUP_ENV]: 'true' }
  });

  return new Promise((resolve, reject) => {
    npmInstall.on('close', (code) => {
      if (code === 0) {
        console.log('npm install completed successfully.');
        if (notifications.length > 0) {
          console.log('\nImportant notifications:');
          notifications.forEach(notification => console.warn(notification));
        }
        resolve();
      } else {
        console.error(`npm install failed with code ${code}`);
        reject(new Error(`npm install failed with code ${code}`));
      }
    });
  });
}

// Execute the setup process
if (require.main === module) {
  setupRepos().catch(error => {
    console.error('Setup failed:', error);
    process.exit(1);
  });
}

// Export the function for use in other scripts if needed
module.exports = setupRepos;
