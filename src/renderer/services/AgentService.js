/**
 * Agent Service
 * Handles agent loading and management
 */

const fs = require('fs');
const path = require('path');
const { agentsDir } = require('../utils/paths');
const { skillsAgentsState } = require('../state');

/**
 * Load all agents from the agents directory
 * @returns {Array}
 */
function loadAgents() {
  const agents = [];

  try {
    if (fs.existsSync(agentsDir)) {
      fs.readdirSync(agentsDir).forEach(item => {
        const itemPath = path.join(agentsDir, item);

        if (fs.statSync(itemPath).isDirectory()) {
          const agentFile = path.join(itemPath, 'AGENT.md');

          if (fs.existsSync(agentFile)) {
            const content = fs.readFileSync(agentFile, 'utf8');
            const nameMatch = content.match(/^#\s+(.+)/m);
            const descMatch = content.match(/description[:\s]+["']?([^"'\n]+)/i);

            agents.push({
              id: item,
              name: nameMatch ? nameMatch[1] : item,
              description: descMatch ? descMatch[1] : 'Aucune description',
              path: itemPath
            });
          }
        }
      });
    }
  } catch (e) {
    console.error('Error loading agents:', e);
  }

  // Update state
  skillsAgentsState.setProp('agents', agents);

  return agents;
}

/**
 * Get all loaded agents
 * @returns {Array}
 */
function getAgents() {
  return skillsAgentsState.get().agents;
}

/**
 * Get agent by ID
 * @param {string} id
 * @returns {Object|undefined}
 */
function getAgent(id) {
  return skillsAgentsState.get().agents.find(a => a.id === id);
}

/**
 * Read agent content
 * @param {string} id - Agent ID
 * @returns {string|null}
 */
function readAgentContent(id) {
  const agent = getAgent(id);
  if (!agent) return null;

  const agentFile = path.join(agent.path, 'AGENT.md');
  try {
    return fs.readFileSync(agentFile, 'utf8');
  } catch (e) {
    console.error('Error reading agent:', e);
    return null;
  }
}

/**
 * Get agent files
 * @param {string} id - Agent ID
 * @returns {Array}
 */
function getAgentFiles(id) {
  const agent = getAgent(id);
  if (!agent) return [];

  const files = [];
  try {
    fs.readdirSync(agent.path).forEach(file => {
      const filePath = path.join(agent.path, file);
      const stat = fs.statSync(filePath);
      files.push({
        name: file,
        path: filePath,
        isDirectory: stat.isDirectory(),
        size: stat.size
      });
    });
  } catch (e) {
    console.error('Error reading agent files:', e);
  }

  return files;
}

/**
 * Delete an agent
 * @param {string} id - Agent ID
 * @returns {boolean}
 */
function deleteAgent(id) {
  const agent = getAgent(id);
  if (!agent) return false;

  try {
    // Remove directory recursively
    fs.rmSync(agent.path, { recursive: true, force: true });
    loadAgents(); // Reload
    return true;
  } catch (e) {
    console.error('Error deleting agent:', e);
    return false;
  }
}

/**
 * Open agent in explorer
 * @param {string} id - Agent ID
 */
function openAgentInExplorer(id) {
  const { ipcRenderer } = require('electron');
  const agent = getAgent(id);
  if (agent) {
    ipcRenderer.send('open-in-explorer', agent.path);
  }
}

module.exports = {
  loadAgents,
  getAgents,
  getAgent,
  readAgentContent,
  getAgentFiles,
  deleteAgent,
  openAgentInExplorer
};
