/**
 * Skill Service
 * Handles skill loading and management
 */

const fs = require('fs');
const path = require('path');
const { skillsDir } = require('../utils/paths');
const { skillsAgentsState } = require('../state');

/**
 * Load all skills from the skills directory
 * @returns {Array}
 */
function loadSkills() {
  const skills = [];

  try {
    if (fs.existsSync(skillsDir)) {
      fs.readdirSync(skillsDir).forEach(item => {
        const itemPath = path.join(skillsDir, item);

        if (fs.statSync(itemPath).isDirectory()) {
          const skillFile = path.join(itemPath, 'SKILL.md');

          if (fs.existsSync(skillFile)) {
            const content = fs.readFileSync(skillFile, 'utf8');
            const nameMatch = content.match(/^#\s+(.+)/m);
            const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));

            skills.push({
              id: item,
              name: nameMatch ? nameMatch[1] : item,
              description: lines[0] || 'Aucune description',
              path: itemPath
            });
          }
        }
      });
    }
  } catch (e) {
    console.error('Error loading skills:', e);
  }

  // Update state
  skillsAgentsState.setProp('skills', skills);

  return skills;
}

/**
 * Get all loaded skills
 * @returns {Array}
 */
function getSkills() {
  return skillsAgentsState.get().skills;
}

/**
 * Get skill by ID
 * @param {string} id
 * @returns {Object|undefined}
 */
function getSkill(id) {
  return skillsAgentsState.get().skills.find(s => s.id === id);
}

/**
 * Read skill content
 * @param {string} id - Skill ID
 * @returns {string|null}
 */
function readSkillContent(id) {
  const skill = getSkill(id);
  if (!skill) return null;

  const skillFile = path.join(skill.path, 'SKILL.md');
  try {
    return fs.readFileSync(skillFile, 'utf8');
  } catch (e) {
    console.error('Error reading skill:', e);
    return null;
  }
}

/**
 * Get skill files
 * @param {string} id - Skill ID
 * @returns {Array}
 */
function getSkillFiles(id) {
  const skill = getSkill(id);
  if (!skill) return [];

  const files = [];
  try {
    fs.readdirSync(skill.path).forEach(file => {
      const filePath = path.join(skill.path, file);
      const stat = fs.statSync(filePath);
      files.push({
        name: file,
        path: filePath,
        isDirectory: stat.isDirectory(),
        size: stat.size
      });
    });
  } catch (e) {
    console.error('Error reading skill files:', e);
  }

  return files;
}

/**
 * Delete a skill
 * @param {string} id - Skill ID
 * @returns {boolean}
 */
function deleteSkill(id) {
  const skill = getSkill(id);
  if (!skill) return false;

  try {
    // Remove directory recursively
    fs.rmSync(skill.path, { recursive: true, force: true });
    loadSkills(); // Reload
    return true;
  } catch (e) {
    console.error('Error deleting skill:', e);
    return false;
  }
}

/**
 * Open skill in explorer
 * @param {string} id - Skill ID
 */
function openSkillInExplorer(id) {
  const { ipcRenderer } = require('electron');
  const skill = getSkill(id);
  if (skill) {
    ipcRenderer.send('open-in-explorer', skill.path);
  }
}

module.exports = {
  loadSkills,
  getSkills,
  getSkill,
  readSkillContent,
  getSkillFiles,
  deleteSkill,
  openSkillInExplorer
};
