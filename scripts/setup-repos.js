/**
 * @fileoverview This script sets up and manages the repositories and plugins for the Lando development environment.
 * It clones or updates predefined lists of Lando-related repositories and plugins, updates their submodules,
 * and runs npm install in the root directory.
 */

const fs = require('fs-extra');
const simpleGit = require('simple-git');
const path = require('path');
const { spawn } = require('child_process');

const SKIP_SETUP_ENV = 'SKIP_SETUP';

// Import the repos and plugins from the JSON file
const { repos, plugins } = require('./repos.json');

/**
 * Sets up a repository or plugin
 * @async
 * @function setupRepo
 * @param {Object} repo - The repository or plugin object
 * @param {string} targetDir - The target directory to clone into
 * @returns {string|null} - A notification message if there were issues, null otherwise
 */
async function setupRepo(repo, targetDir) {
  const repoPath = path.join(targetDir, repo.name);
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
        return `package-lock.json was reset in ${repo.name}. You may need to redo any package updates.`;
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
          return `Merge conflict when reapplying changes in ${repo.name}. Please resolve conflicts manually.`;
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
    return `Error in ${repo.name}: ${error.message}. Please check and update manually if needed.`;
  }

  return null;
}

/**
 * Sets up all repositories and plugins, and runs npm install
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
  const pluginsDir = path.join(__dirname, '..', 'plugins');
  const notifications = [];

  // Ensure the repos and plugins directories exist
  await fs.ensureDir(reposDir);
  await fs.ensureDir(pluginsDir);

  // Setup repos
  for (const repo of repos) {
    const notification = await setupRepo(repo, reposDir);
    if (notification) notifications.push(notification);
  }

  // Setup plugins
  for (const plugin of plugins) {
    const notification = await setupRepo(plugin, pluginsDir);
    if (notification) notifications.push(notification);
  }

  console.log('All repositories and plugins have been processed.');

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
