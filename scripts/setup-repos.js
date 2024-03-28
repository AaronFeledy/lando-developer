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

      // Get current branch information
      const branchInfo = await git.branch();
      const currentBranch = branchInfo.current;

      if (status.modified.includes('package-lock.json')) {
        console.log(`Resetting package-lock.json in ${repo.name}...`);
        await git.checkout(['--', 'package-lock.json']);
        return `package-lock.json was reset in ${repo.name}. You may need to redo any package updates.`;
      }

      // Handle non-main branch scenario
      if (currentBranch !== 'main') {
        if (status.modified.length === 0 && status.not_added.length === 0) {
          console.log(`${repo.name} is on branch '${currentBranch}' with clean working tree. Switching to main...`);
          await git.fetch(['--prune']);
          await git.checkout('main');
          await git.pull();
        } else {
          return `${repo.name} is on branch '${currentBranch}' with uncommitted changes. Skipping branch switch.`;
        }
      } else {
        // On main branch
        if (status.modified.length > 0 || status.not_added.length > 0) {
          console.log(`Local changes detected in ${repo.name}. Stashing changes...`);
          await git.stash(['save', `Automatic stash by setup script`]);
        }

        console.log(`Fetching and pulling latest changes for ${repo.name}...`);
        await git.fetch(['--prune']);
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
  const issueTracking = {
    branchIssues: [],
    mergeConflicts: [],
    errors: []
  };

  // Ensure the repos and plugins directories exist
  await fs.ensureDir(reposDir);
  await fs.ensureDir(pluginsDir);

  // Setup repos
  for (const repo of repos) {
    const notification = await setupRepo(repo, reposDir);
    if (notification) {
      notifications.push(notification);
      // Track specific issues
      if (notification.includes('uncommitted changes')) {
        issueTracking.branchIssues.push(repo.name);
      } else if (notification.includes('Merge conflict')) {
        issueTracking.mergeConflicts.push(repo.name);
      } else {
        issueTracking.errors.push(repo.name);
      }
    }
  }

  // Setup plugins
  for (const plugin of plugins) {
    const notification = await setupRepo(plugin, pluginsDir);
    if (notification) {
      notifications.push(notification);
      // Track specific issues
      if (notification.includes('uncommitted changes')) {
        issueTracking.branchIssues.push(plugin.name);
      } else if (notification.includes('Merge conflict')) {
        issueTracking.mergeConflicts.push(plugin.name);
      } else {
        issueTracking.errors.push(plugin.name);
      }
    }
  }

  console.log('All repositories and plugins have been processed.');

  console.log('\nRunning npm install with SKIP_SETUP flag...');

  const npmInstall = spawn('npm', ['install'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env, [SKIP_SETUP_ENV]: 'true' }
  });

  return new Promise((resolve, reject) => {
    npmInstall.on('close', (code) => {
      if (code === 0) {
        console.log('npm install completed successfully.');

        // Only show summary if there are any issues or notifications
        if (notifications.length > 0 ||
          issueTracking.branchIssues.length > 0 ||
          issueTracking.mergeConflicts.length > 0 ||
          issueTracking.errors.length > 0) {

          console.log('\n' + '='.repeat(80));
          console.log('🚨 REPOSITORY STATUS SUMMARY - ATTENTION REQUIRED 🚨');
          console.log('='.repeat(80));

          // Helper function to format repo name with its directory
          const formatRepoPath = (repoName) => {
            const isPlugin = plugins.some(p => p.name === repoName);
            return `${isPlugin ? 'plugins' : 'repos'}/${repoName}`;
          };

          // Helper function to format notifications with proper indentation and line breaks
          const formatNotification = (notification) => {
            return notification
              .split('\n')
              .map(line => `        ${line.trim()}`)
              .join('\n');
          };

          if (issueTracking.branchIssues.length > 0) {
            console.log('\n⚠️  Repos with branch/uncommitted changes issues:');
            issueTracking.branchIssues.forEach(repo => {
              console.log(`\n    >>> ${formatRepoPath(repo)} <<<`);
              // Find and display related notification
              notifications
                .filter(n => n.includes(repo) && n.includes('uncommitted changes'))
                .forEach(n => console.log(`\n${formatNotification(n)}`));
            });
          }

          if (issueTracking.mergeConflicts.length > 0) {
            console.log('\n❌ Repos with merge conflicts:');
            issueTracking.mergeConflicts.forEach(repo => {
              console.log(`\n    >>> ${formatRepoPath(repo)} <<<`);
              // Find and display related notification
              notifications
                .filter(n => n.includes(repo) && n.includes('Merge conflict'))
                .forEach(n => console.log(`\n${formatNotification(n)}`));
            });
          }

          if (issueTracking.errors.length > 0) {
            console.log('\n⚡ Repos with other errors:');
            issueTracking.errors.forEach(repo => {
              console.log(`\n    >>> ${formatRepoPath(repo)} <<<`);
              // Find and display related notification
              notifications
                .filter(n => n.includes(repo) && !n.includes('uncommitted changes') && !n.includes('Merge conflict'))
                .forEach(n => console.log(`\n${formatNotification(n)}`));
            });
          }

          // Display any notifications that weren't associated with tracked issues
          const untrackedNotifications = notifications.filter(n =>
            !issueTracking.branchIssues.some(repo => n.includes(repo)) &&
            !issueTracking.mergeConflicts.some(repo => n.includes(repo)) &&
            !issueTracking.errors.some(repo => n.includes(repo))
          );

          if (untrackedNotifications.length > 0) {
            console.log('\n📝 Other notifications:');
            untrackedNotifications.forEach(n => console.log(`\n    ${formatNotification(n)}`));
          }

          console.log('\n' + '='.repeat(80));
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
