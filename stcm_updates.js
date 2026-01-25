// stcm_updates.js
// Character update management - check for and apply updates from source URLs

import { characters } from '../../../../script.js';
import { tags, tag_map } from '../../../tags.js';
import { callSaveandReload } from './index.js';
import { uuidv4 } from '../../../utils.js';

/**
 * Get all characters that have a source URL
 * @returns {Array<{index: number, name: string, avatar: string, sourceUrl: string}>}
 */
export function getCharactersWithSources() {
    const result = [];

    for (let i = 0; i < characters.length; i++) {
        const char = characters[i];
        if (!char) continue;

        // Use ST's getCharacterSource if available, otherwise check manually
        let sourceUrl = '';
        try {
            if (typeof getCharacterSource === 'function') {
                sourceUrl = getCharacterSource(i);
            }
        } catch (e) {
            // Fall back to manual check
        }

        if (!sourceUrl) {
            // Check common source URL locations
            sourceUrl = char?.data?.extensions?.source_url
                || char?.data?.extensions?.chub?.full_path
                || '';

            // Build Chub URL if we have chub data
            if (!sourceUrl && char?.data?.extensions?.chub?.full_path) {
                sourceUrl = `https://chub.ai/characters/${char.data.extensions.chub.full_path}`;
            }
        }

        if (sourceUrl) {
            result.push({
                index: i,
                name: char.name || 'Unknown',
                avatar: char.avatar || '',
                sourceUrl: sourceUrl
            });
        }
    }

    return result;
}

/**
 * Render the updates list
 */
export function renderUpdatesList() {
    const wrapper = document.getElementById('updatesListWrapper');
    const statusMsg = document.getElementById('updatesStatusMsg');
    if (!wrapper) return;

    const charsWithSources = getCharactersWithSources();

    if (charsWithSources.length === 0) {
        wrapper.innerHTML = `
            <div style="padding: 1em; opacity: 0.7; text-align: center;">
                No characters with source URLs found.<br>
                Characters imported from Chub or other sources will appear here.
            </div>
        `;
        if (statusMsg) statusMsg.textContent = '';
        return;
    }

    if (statusMsg) {
        statusMsg.textContent = `${charsWithSources.length} character(s) with source URLs`;
    }

    // Build table
    let html = `
        <table class="stcm_updates_table">
            <thead>
                <tr>
                    <th style="width: 40px;"></th>
                    <th>Character</th>
                    <th>Source</th>
                    <th style="width: 180px;">Actions</th>
                </tr>
            </thead>
            <tbody>
    `;

    for (const char of charsWithSources) {
        const avatarUrl = char.avatar
            ? `/characters/${encodeURIComponent(char.avatar)}`
            : '/img/ai4.png';

        // Truncate URL for display
        const displayUrl = char.sourceUrl.length > 50
            ? char.sourceUrl.substring(0, 47) + '...'
            : char.sourceUrl;

        html += `
            <tr data-char-index="${char.index}" data-source-url="${escapeHtml(char.sourceUrl)}">
                <td>
                    <img src="${avatarUrl}" alt="" style="width: 36px; height: 36px; border-radius: 4px; object-fit: cover;">
                </td>
                <td>
                    <strong>${escapeHtml(char.name)}</strong>
                </td>
                <td>
                    <a href="${escapeHtml(char.sourceUrl)}" target="_blank" title="${escapeHtml(char.sourceUrl)}" style="color: var(--SmartThemeQuoteColor, #8cf);">
                        ${escapeHtml(displayUrl)}
                    </a>
                </td>
                <td>
                    <button class="stcm_menu_button small interactable stcm-update-char-btn" title="Update character from source">
                        <i class="fa-solid fa-download"></i> Update
                    </button>
                    <button class="stcm_menu_button small interactable stcm-import-tags-btn" title="Import tags from source">
                        <i class="fa-solid fa-tags"></i> Tags
                    </button>
                </td>
            </tr>
        `;
    }

    html += '</tbody></table>';
    wrapper.innerHTML = html;

    // Wire up buttons
    wrapper.querySelectorAll('.stcm-update-char-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const row = e.target.closest('tr');
            const charIndex = parseInt(row.dataset.charIndex, 10);
            const sourceUrl = row.dataset.sourceUrl;
            await updateCharacterFromSource(charIndex, sourceUrl, btn);
        });
    });

    wrapper.querySelectorAll('.stcm-import-tags-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const row = e.target.closest('tr');
            const charIndex = parseInt(row.dataset.charIndex, 10);
            await importTagsForCharacter(charIndex, btn);
        });
    });
}

/**
 * Update a character from its source URL
 * Opens the source URL in a new tab for the user to manually download
 * (Full automation would require accessing internal ST functions)
 */
async function updateCharacterFromSource(charIndex, sourceUrl, btn) {
    const char = characters[charIndex];
    if (!char) {
        toastr.error('Character not found');
        return;
    }

    // Open the source URL so user can download the updated card
    window.open(sourceUrl, '_blank');
    toastr.info(`Opened source for "${char.name}". Download the card and use Replace/Update from the character menu.`);
}

/**
 * Import tags for a character from its embedded tag data
 * Characters imported from Chub often have tags stored in their data
 */
async function importTagsForCharacter(charIndex, btn) {
    const char = characters[charIndex];
    if (!char) {
        toastr.error('Character not found');
        return;
    }

    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
        // Check for embedded tags in character data
        const embeddedTags = char.tags || char.data?.tags || [];

        if (!embeddedTags || embeddedTags.length === 0) {
            toastr.warning(`No embedded tags found for "${char.name}"`);
            return;
        }

        // Import the embedded tags
        const result = await applyEmbeddedTags(charIndex, embeddedTags);
        if (result.added > 0) {
            toastr.success(`Added ${result.added} tag(s) to "${char.name}"`);
        } else {
            toastr.info(`No new tags to add for "${char.name}" (${result.existing} already applied)`);
        }
    } catch (err) {
        console.error('Failed to import tags:', err);
        toastr.error(`Failed to import tags for "${char.name}": ${err.message || 'Unknown error'}`);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

/**
 * Apply embedded tags to a character
 */
async function applyEmbeddedTags(charIndex, embeddedTags) {
    const char = characters[charIndex];
    const charKey = char.avatar; // This is the key used in tag_map

    let added = 0;
    let existing = 0;

    // Ensure character has an entry in tag_map
    if (!tag_map[charKey]) {
        tag_map[charKey] = [];
    }

    for (const tagName of embeddedTags) {
        const cleanName = String(tagName).trim();
        if (!cleanName) continue;

        // Find or create the tag
        let tag = tags.find(t => t.name.toLowerCase() === cleanName.toLowerCase());

        if (!tag) {
            // Create new tag
            const styles = getComputedStyle(document.body);
            const defaultBg = styles.getPropertyValue('--SmartThemeShadowColor')?.trim() || '#cccccc';
            const defaultFg = styles.getPropertyValue('--SmartThemeBodyColor')?.trim() || '#000000';

            tag = {
                id: uuidv4(),
                name: cleanName,
                color: defaultBg,
                color2: defaultFg,
                folder_type: 'NONE',
            };
            tags.push(tag);
        }

        // Add tag to character if not already present
        if (!tag_map[charKey].includes(tag.id)) {
            tag_map[charKey].push(tag.id);
            added++;
        } else {
            existing++;
        }
    }

    if (added > 0) {
        await callSaveandReload();
    }

    return { added, existing };
}

/**
 * Import embedded tags for all characters
 */
export async function importAllTags() {
    const statusMsg = document.getElementById('updatesStatusMsg');

    // Get all characters with embedded tags
    const charsWithTags = [];
    for (let i = 0; i < characters.length; i++) {
        const char = characters[i];
        const embeddedTags = char?.tags || char?.data?.tags || [];
        if (embeddedTags.length > 0) {
            charsWithTags.push({ index: i, name: char.name, tags: embeddedTags });
        }
    }

    if (charsWithTags.length === 0) {
        toastr.info('No characters with embedded tags found');
        return;
    }

    let totalAdded = 0;
    let charsUpdated = 0;

    for (let i = 0; i < charsWithTags.length; i++) {
        const charInfo = charsWithTags[i];

        if (statusMsg) {
            statusMsg.textContent = `Importing tags... ${i + 1}/${charsWithTags.length}`;
        }

        try {
            const result = await applyEmbeddedTags(charInfo.index, charInfo.tags);
            if (result.added > 0) {
                totalAdded += result.added;
                charsUpdated++;
            }
        } catch (err) {
            console.error(`Failed to import tags for ${charInfo.name}:`, err);
        }
    }

    if (statusMsg) {
        const charsWithSources = getCharactersWithSources();
        statusMsg.textContent = `${charsWithSources.length} character(s) with source URLs`;
    }

    toastr.success(`Added ${totalAdded} tag(s) across ${charsUpdated} character(s)`);
}

/**
 * Attach event listeners for the Updates section
 */
export function attachUpdatesSectionListeners() {
    const refreshBtn = document.getElementById('refreshUpdatesListBtn');
    const importAllBtn = document.getElementById('importAllTagsBtn');

    refreshBtn?.addEventListener('click', () => {
        renderUpdatesList();
    });

    importAllBtn?.addEventListener('click', async () => {
        const confirmed = await confirmAction(
            'Import All Tags',
            'This will import tags for all characters with source URLs. Existing tags will be replaced. Continue?'
        );
        if (confirmed) {
            await importAllTags();
        }
    });
}

/**
 * Simple confirmation dialog
 */
async function confirmAction(title, message) {
    return new Promise(resolve => {
        const result = confirm(`${title}\n\n${message}`);
        resolve(result);
    });
}

/**
 * Escape HTML entities
 */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}
