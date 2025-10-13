// utils.js
import {
    getContext,
} from "../../../extensions.js";
import { 
    callGenericPopup,
    POPUP_TYPE,
    POPUP_RESULT 
} from '../../../popup.js';

import {
    eventSource,
    event_types,
    syncSwipeToMes,
    messageFormatting
} from "../../../../script.js";

import { tags, tag_map } from "../../../tags.js";
import { STCM } from "./index.js";
import { getEntitiesList } from "../../../../script.js";

let context = null;

function ensureContext() {
    if (!context) {
        context = getContext();
    }
}

/**
 * Check if Dev Mode is enabled (for conditional logging)
 * @returns {boolean}
 */
function isDevMode() {
    try {
        ensureContext();
        const MODULE_NAME = 'characterTagManager';
        return context?.extensionSettings?.[MODULE_NAME]?.devMode ?? false;
    } catch {
        return false;
    }
}

let tagFilterBarObserver = null;  // Singleton observer for tag filter bar

function debounce(fn, delay = 200) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

let persistDebounceTimer;
function debouncePersist() {
    clearTimeout(persistDebounceTimer);
    persistDebounceTimer = setTimeout(() => {
        ensureContext();
        context.saveSettingsDebounced();
    }, 500);
}

function flushExtSettings() {
    debouncePersist();
}

function getFreeName(base, existingNames) {
    const lowerSet = new Set(existingNames.map(n => n.toLowerCase()));
    let index = 1;
    let newName = base;
    while (lowerSet.has(newName.toLowerCase())) {
        newName = `${base} ${index++}`;
    }
    return newName;
}

function isNullColor(color) {
    if (typeof color !== 'string') return true;
    const c = color.trim().toLowerCase();
    return !c || c === '#' || c === 'rgba(0, 0, 0, 1)';
}

function escapeHtml(text) {
    if (typeof text !== 'string') {
        return text == null ? '' : String(text);
    }
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function getCharacterNameById(id, charNameMap) {
    return charNameMap.get(id) || null;
}

function normalizeValue(value) {
    if (value === null || value === undefined) {
        return '';
    }
    
    if (typeof value !== 'string') {
        return String(value);
    }
    
    // Normalize line endings to \n
    return value
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
}

/**
 * Universal character save function using the /edit endpoint with FormData
 * Properly handles spec v2/v3 synchronization via charaFormatData
 * @param {Object} character - The complete character object to save
 * @param {Object} changes - Optional partial changes to apply before saving
 * @param {boolean} updateUI - Whether to refresh the UI after saving
 * @returns {Promise<boolean>} - True if save was successful
 */
async function stcm_saveCharacter(character, changes = null, updateUI = true) {
    try {
        ensureContext();
        
        // Create a complete copy of the character
        const updatedCharacter = JSON.parse(JSON.stringify(character));
        
        // Apply any changes if provided, with normalization and validation
        if (changes && typeof changes === 'object') {
            const normalizedChanges = {};
            const rejectedFields = [];
            
            for (const [fieldKey, newValue] of Object.entries(changes)) {
                // Normalize the value before applying
                normalizedChanges[fieldKey] = normalizeValue(newValue);
            }
            
            for (const [fieldKey, normalizedValue] of Object.entries(normalizedChanges)) {
                const success = setFieldValue(updatedCharacter, fieldKey, normalizedValue);
                if (!success) {
                    rejectedFields.push(fieldKey);
                }
            }
            
            // Warn user if any fields were rejected
            if (rejectedFields.length > 0) {
                console.warn('[STCM] Rejected invalid fields:', rejectedFields);
                toastr.warning(`Ignored invalid fields: ${rejectedFields.join(', ')}`);
            }
        }
        
        // Build FormData from the complete updated character
        const formData = new FormData();
        
        // Basic fields from root level
        formData.append('ch_name', updatedCharacter.name || updatedCharacter.data?.name || '');
        formData.append('avatar_url', updatedCharacter.avatar || '');
        formData.append('description', updatedCharacter.description || updatedCharacter.data?.description || '');
        formData.append('first_mes', updatedCharacter.first_mes || updatedCharacter.data?.first_mes || '');
        formData.append('scenario', updatedCharacter.scenario || updatedCharacter.data?.scenario || '');
        formData.append('personality', updatedCharacter.personality || updatedCharacter.data?.personality || '');
        formData.append('mes_example', updatedCharacter.mes_example || updatedCharacter.data?.mes_example || '');
        formData.append('creatorcomment', updatedCharacter.creatorcomment || updatedCharacter.data?.creator_notes || '');
        formData.append('tags', (updatedCharacter.tags || []).join(','));

        // Get and add the avatar file
        try {
            const avatarUrl = context.getThumbnailUrl('avatar', updatedCharacter.avatar);
            const avatarBlob = await fetch(avatarUrl).then(res => res.blob());
            const avatarFile = new File([avatarBlob], 'avatar.png', { type: 'image/png' });
            formData.append('avatar', avatarFile);
        } catch (avatarError) {
            if (isDevMode()) {
            console.warn('[STCM] Could not fetch avatar file:', avatarError);
            }
        }

        // Extended character data fields from data object
        const charInnerData = updatedCharacter.data || {};
        
        formData.append('creator', charInnerData.creator || '');
        formData.append('character_version', charInnerData.character_version || '');
        formData.append('creator_notes', charInnerData.creator_notes || '');
        formData.append('system_prompt', charInnerData.system_prompt || '');
        formData.append('post_history_instructions', charInnerData.post_history_instructions || '');

        // Extensions data
        const extensions = charInnerData.extensions || {};
        formData.append('chat', updatedCharacter.chat || '');
        formData.append('create_date', updatedCharacter.create_date || '');
        formData.append('last_mes', updatedCharacter.last_mes || '');
        formData.append('talkativeness', extensions.talkativeness ?? '');
        formData.append('fav', String(extensions.fav ?? false));
        formData.append('world', extensions.world || '');

        // Depth prompt data
        const depthPrompt = extensions.depth_prompt || {};
        formData.append('depth_prompt_prompt', depthPrompt.prompt || '');
        formData.append('depth_prompt_depth', String(depthPrompt.depth ?? 4));
        formData.append('depth_prompt_role', depthPrompt.role || '');

        // Alternate greetings - extract strings from objects if needed
        if (Array.isArray(charInnerData.alternate_greetings)) {
            for (const greeting of charInnerData.alternate_greetings) {
                // Extract the 'mes' property if it's an object, otherwise use as-is
                const greetingText = typeof greeting === 'object' && greeting.mes 
                    ? greeting.mes 
                    : greeting;
                if (greetingText) {
                    formData.append('alternate_greetings', greetingText);
                }
            }
        }

        // CRITICAL: Pass the complete json_data object
        formData.append('json_data', JSON.stringify(updatedCharacter));

        // Get headers and remove Content-Type (let browser set it for FormData)
        const headers = context.getRequestHeaders();
        delete headers['Content-Type'];

        const response = await fetch('/api/characters/edit', {
            method: 'POST',
            headers: headers,
            body: formData,
            cache: 'no-cache'
        });

        if (!response.ok) {
            let errorMessage = 'Failed to save character.';
            try {
                const errorText = await response.text();
                if (errorText) {
                    errorMessage = `Character not saved. Error: ${errorText}`;
                }
            } catch {
                errorMessage = `Failed to save character. Status: ${response.status} ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }

        // Update the original character object with the changes
        Object.assign(character, updatedCharacter);

        // Update json_data field if it exists
        if (character.json_data) {
            character.json_data = JSON.stringify(updatedCharacter);
        }

        if (updateUI) {
            // Use SillyTavern's native character refresh methods
            if (typeof context.getCharacters === 'function') {
                await context.getCharacters();
            }
            
            // Trigger character edited event if available
            if (context.eventSource && context.event_types?.CHARACTER_EDITED) {
                context.eventSource.emit(context.event_types.CHARACTER_EDITED, character);
            }
        }

        return true;

    } catch (error) {
        console.error('[STCM] Save character failed:', error);
        throw error;
    }
}

/**
 * Helper function to set a field value in a character object using dot notation
 * @param {Object} char - Character object
 * @param {string} fieldKey - Field key (supports dot notation like 'data.creator')
 * @param {*} newValue - New value to set
 * @returns {boolean} - True if field was set, false if invalid
 */
function setFieldValue(char, fieldKey, newValue) {
    // Define all valid root-level fields based on the character card schema
    const VALID_ROOT_FIELDS = [
        'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
        'creatorcomment', 'avatar', 'chat', 'talkativeness', 'fav', 'tags',
        'spec', 'spec_version', 'create_date', 'last_mes'
    ];

    // Handle unified.creator_notes FIRST - before any other checks
    if (fieldKey === 'unified.creator_notes') {
        char.creatorcomment = newValue;
        if (!char.data) char.data = {};
        char.data.creator_notes = newValue;
        return true;
    }
    
    // Handle data.alternate_greetings specifically
    if (fieldKey === 'data.alternate_greetings') {
        if (!char.data) char.data = {};
        
        // Ensure it's an array of objects with .mes property
        let greetings = [];
        if (Array.isArray(newValue)) {
            greetings = newValue.map(item => 
                typeof item === 'object' && item.mes ? item : { mes: String(item) }
            );
        }
        
        char.data.alternate_greetings = greetings;
        char.alternate_greetings = greetings;
        return true;
    }
    
    if (fieldKey === 'alternate_greetings') {
        // Handle alternate greetings as array
        let greetings = [];
        if (typeof newValue === 'string') {
            const messages = newValue.split('\n\n---\n\n').map(g => g.trim()).filter(g => g);
            greetings = messages.map(mes => ({ mes }));
        } else if (Array.isArray(newValue)) {
            greetings = newValue.map(item => 
                typeof item === 'object' && item.mes ? item : { mes: String(item) }
            );
        }
        
        if (!char.data) char.data = {};
        char.data.alternate_greetings = greetings;
        char.alternate_greetings = greetings;
        return true;
    }
    
    // Handle individual alternate greetings
    if (fieldKey.startsWith('alternate_greetings[') && fieldKey.includes('.mes')) {
        const match = fieldKey.match(/alternate_greetings\[(\d+)\]\.mes/);
        if (match) {
            const index = parseInt(match[1]);
            if (!char.data) char.data = {};
            if (!char.data.alternate_greetings) char.data.alternate_greetings = [];
            if (!char.alternate_greetings) char.alternate_greetings = [];
            
            while (char.data.alternate_greetings.length <= index) {
                char.data.alternate_greetings.push({ mes: '' });
            }
            while (char.alternate_greetings.length <= index) {
                char.alternate_greetings.push({ mes: '' });
            }
            
            char.data.alternate_greetings[index] = { mes: newValue };
            char.alternate_greetings[index] = { mes: newValue };
            return true;
        }
    }
    
    // Shared fields between root level and data object
    const SHARED_SPEC_FIELDS = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example'];
    
    if (SHARED_SPEC_FIELDS.includes(fieldKey)) {
        if (!char.data) char.data = {};
        char[fieldKey] = newValue;
        char.data[fieldKey] = newValue;
        return true;
    }
    
    // Handle nested data fields
    if (fieldKey.startsWith('data.')) {
        if (!char.data) char.data = {};
        const dataPath = fieldKey.substring(5);
        const keys = dataPath.split('.');
        let target = char.data;
        
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!target[key]) target[key] = {};
            target = target[key];
        }
        
        target[keys[keys.length - 1]] = newValue;
        return true;
    }
    
    // Handle valid root-level fields only
    if (VALID_ROOT_FIELDS.includes(fieldKey)) {
        char[fieldKey] = newValue;
        return true;
    }
    
    // If we get here, the field is invalid - log and reject
    if (isDevMode()) {
        console.warn(`[STCM] Rejected invalid field key: "${fieldKey}"`);
    }
    return false;
}

function resetModalScrollPositions() {
    requestAnimationFrame(() => {
        const modal = document.getElementById('characterTagManagerModal');
        if (modal) modal.scrollTo({ top: 0 });

        const scrollables = modal?.querySelectorAll('.modalBody, .accordionContent, #characterListContainer');
        scrollables?.forEach(el => el.scrollTop = 0);

        requestAnimationFrame(() => scrollables?.forEach(el => el.scrollTop = 0));
    });
}

function makeModalDraggable(modal, handle, onDragEnd = null) {
    let isDragging = false;
    let offsetX, offsetY;

    handle.style.cursor = 'move';

    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        const rect = modal.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;

        modal.style.position = 'fixed';
        modal.style.zIndex   = 10000;
        modal.style.margin   = 0;
        document.body.style.userSelect = 'none';
    });

    function onMove(e) {
        if (!isDragging) return;
        const modalWidth = modal.offsetWidth;
        const modalHeight = modal.offsetHeight;
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;
    
        // Clamp so modal never leaves the viewport!
        let newLeft = e.clientX - offsetX;
        let newTop  = e.clientY - offsetY;
    
        // Clamp left/top so modal never goes outside window
        if (newLeft < 0) newLeft = 0;
        if (newTop < 0) newTop = 0;
    
        // Clamp right/bottom so modal never goes outside window
        if (newLeft + modalWidth > winWidth)  newLeft = winWidth  - modalWidth;
        if (newTop  + modalHeight > winHeight) newTop = winHeight - modalHeight;
    
        // Prevent negative values after clamp
        if (newLeft < 0) newLeft = 0;
        if (newTop < 0) newTop = 0;
    
        modal.style.left = `${newLeft}px`;
        modal.style.top  = `${newTop}px`;
    }
    

    function onUp() {
        if (!isDragging) return;
        isDragging = false;
        document.body.style.userSelect = '';
        clampModalSize(modal, 0);
        if (onDragEnd) onDragEnd();
    }

    // global mouse handlers
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);

    /* ---------- clean-up when the modal is removed ---------- */
    const cleanupObserver = new MutationObserver((records, observer) => {
        for (const { removedNodes } of records) {
            for (const node of removedNodes) {
                if (node === modal) {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup',   onUp);
                    observer.disconnect();
                    return;
                }
            }
        }
    });

    // watch the modal’s parent (fallback to <body>)
    cleanupObserver.observe(modal.parentNode || document.body, { childList: true });
}

const STORAGE_KEY = 'stcm_modal_pos_size';

function saveModalPosSize(modalContent) {
    const rect = modalContent.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 100 || (rect.left === 0 && rect.top === 0)) return;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(rect));
}

/**
 * Clamp a draggable / resizable modal so it never leaves the viewport.
 * @param {HTMLElement} modalEl – the element you want to constrain
 * @param {number} [margin=20] – free space to keep between the modal and window edges
 * @returns {boolean} true if any dimension or position was changed
 */
function clampModalSize(modalEl, margin = 20) {
    const maxWidth  = window.innerWidth  - margin;
    const maxHeight = window.innerHeight - margin;
    let changed = false;
  
    // -------- Size --------
    if (modalEl.offsetWidth > maxWidth) {
      modalEl.style.width = `${maxWidth}px`;
      changed = true;
    }
    if (modalEl.offsetHeight > maxHeight) {
      modalEl.style.height = `${maxHeight}px`;
      changed = true;
    }
  
    // -------- Position --------
    const rect = modalEl.getBoundingClientRect();
    // Right / bottom edges
    if (rect.right > window.innerWidth) {
      modalEl.style.left = `${Math.max(0, window.innerWidth - rect.width)}px`;
      changed = true;
    }
    if (rect.bottom > window.innerHeight) {
      modalEl.style.top = `${Math.max(0, window.innerHeight - rect.height)}px`;
      changed = true;
    }
    // Left / top edges (don’t let header fly off-screen)
    if (rect.left < 0) {
      modalEl.style.left = '0px';
      changed = true;
    }
    if (rect.top < 0) {
      modalEl.style.top = '0px';
      changed = true;
    }
  
    return changed;
  }

  export function createMinimizableModalControls(modal, minimizeText = 'Restore', icon = null) {
    // Ensure the tray exists
    let tray = document.getElementById('minimizedModalsTray');
    if (!tray) {
        tray = document.createElement('div');
        tray.id = 'minimizedModalsTray';
        tray.className = 'minimizedModalsTray';
        document.body.appendChild(tray);
    }

    // Minimized bar (click to restore)
    const minimizedBar = document.createElement('div');
    minimizedBar.className = 'minimized-modal-bar';
    minimizedBar.style.display = 'none';

    // Optional icon (font-awesome or image)
    if (icon) {
        const iconEl = icon.startsWith('fa')
            ? document.createElement('i')
            : document.createElement('img');

        if (icon.startsWith('fa')) {
            iconEl.className = icon + ' minimized-icon';
        } else {
            iconEl.src = icon;
            iconEl.alt = 'icon';
            iconEl.className = 'minimized-img-icon';
        }

        minimizedBar.appendChild(iconEl);
    }

    // Text label
    const label = document.createElement('span');
    label.className = 'minimized-label';
    label.textContent = minimizeText;
    minimizedBar.appendChild(label);

    // Clicking the bar restores the modal
    minimizedBar.addEventListener('click', () => {
        modal.style.display = 'block';
        minimizedBar.style.display = 'none';
    });

    // Minimize button (goes inside the modal header typically)
    const minimizeBtn = document.createElement('button');
    minimizeBtn.className = 'minimize-modal-btn';
    minimizeBtn.textContent = '–';
    minimizeBtn.title = 'Minimize';

    minimizedBar.addEventListener('click', () => {
        modal.style.display = 'block';
        modal.style.zIndex = getNextZIndex();  // ← bring to front
        minimizedBar.style.display = 'none';
    });

    minimizedBar.addEventListener('click', () => {
        modal.style.display = 'block';
        minimizedBar.style.display = 'none';
    });

    // Add to the tray
    tray.appendChild(minimizedBar);

    return { minimizeBtn, minimizedBar };
}



  function restoreCharEditModal() {
    const modal = document.getElementById('stcmCharEditModal');
    const data = sessionStorage.getItem('stcm_char_edit_modal_pos_size');
    if (!data) return;
    try {
        const rect = JSON.parse(data);
        if (rect.width && rect.height) {
            modal.style.width = `${rect.width}px`;
            modal.style.height = `${rect.height}px`;
        }
        if (rect.left !== undefined && rect.top !== undefined) {
            modal.style.left = `${rect.left}px`;
            modal.style.top = `${rect.top}px`;
        }
    } catch (e) {
        if (isDevMode()) {
        console.warn('Failed to restore edit modal position/size');
        }
    }
}


let highestZIndex = 10000;

export function getNextZIndex() {
    return ++highestZIndex;
}


function cleanTagMap(tag_map, characters = [], groups = []) {
    // Build a list of every still-valid character / group id
    const validIds = new Set([
        ...characters.map(c => c.avatar),
        ...groups.map(g => g.id),
    ]);

    // Strip any orphaned ids out of the map
    for (const charId of Object.keys(tag_map)) {
        if (!validIds.has(charId)) {
            delete tag_map[charId];
        }
    }
}

function buildTagMap(tags) {
    return new Map(tags.map(tag => [tag.id, tag]));
}

// ---- Auto-backup of tags + tag_map ----
function getStcmBucket() {
    ensureContext();
    if (!context.extensionSettings.stcm) context.extensionSettings.stcm = {};
    return context.extensionSettings.stcm;
}

/**
 * Save a snapshot of {tags, tag_map} into extension settings.
 * Keeps only the most recent RETAIN snapshots.
 */
function addTagMapBackup(reason = 'manual') {
    ensureContext();
    const stcm = getStcmBucket();
    const nowIso = new Date().toISOString();

    const snapshot = {
        created_at: nowIso,
        reason,
        // shallow copy tags array with plain objects
        tags: Array.isArray(tags) ? tags.map(t => ({ ...t })) : [],
        // deep copy map
        tag_map: tag_map && typeof tag_map === 'object' ? JSON.parse(JSON.stringify(tag_map)) : {}
    };

    if (!Array.isArray(stcm.tagMapBackups)) stcm.tagMapBackups = [];
    stcm.tagMapBackups.unshift(snapshot);

    const RETAIN = 3; // keep last 3 backups
    if (stcm.tagMapBackups.length > RETAIN) {
        stcm.tagMapBackups.length = RETAIN;
    }

    context.saveSettingsDebounced();
}

/**
 * Create an "install" backup on first run after install
 * and a "launch" backup once per day.
 */
function tryAutoBackupTagMapOnLaunch() {
    ensureContext();
    const stcm = getStcmBucket();
    const today = new Date().toISOString().split('T')[0];

    // First run after install?
    if (!stcm.didInstallBackup) {
        addTagMapBackup('install');
        stcm.didInstallBackup = true;
    }

    // Launch backup (daily throttle)
    if (stcm.lastLaunchBackupYMD !== today) {
        addTagMapBackup('launch');
        stcm.lastLaunchBackupYMD = today;
    }

    context.saveSettingsDebounced();
}


function buildCharNameMap(characters) {
    return new Map(characters.map(char => [char.avatar, char.name]));
}

function getNotes() {
    ensureContext();
    // create the bucket if it isn’t there
    if (!context.extensionSettings.stcm) context.extensionSettings.stcm = {};
    return context.extensionSettings.stcm.notes ?? { charNotes: {}, tagNotes: {} };
}

function saveNotes(notes) {
    ensureContext();
    // create the bucket if it isn’t there
    if (!context.extensionSettings.stcm) context.extensionSettings.stcm = {};
    context.extensionSettings.stcm.notes = notes;
    context.saveSettingsDebounced();
}

function watchTagFilterBar(injectTagManagerControlButton) {
    const tagRow = document.querySelector('.tags.rm_tag_filter');
    if (!tagRow) return;
    if (tagFilterBarObserver) tagFilterBarObserver.disconnect();
    injectTagManagerControlButton();

    tagFilterBarObserver = new MutationObserver(injectTagManagerControlButton);
    tagFilterBarObserver.observe(tagRow, { childList: true });
}

async function promptInput({ label, title = 'Input', ok = 'OK', cancel = 'Cancel', initial = '' }) {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = initial;
        input.className = 'menu_input stcm_generic_toast_input';
        input.style.width = '100%';

        const wrapper = document.createElement('div');
        wrapper.textContent = label;
        wrapper.append(document.createElement('br'), input);

        callGenericPopup(wrapper, POPUP_TYPE.CONFIRM, title, {
            okButton: ok,
            cancelButton: cancel
        }).then(result => resolve(result === POPUP_RESULT.AFFIRMATIVE ? input.value.trim() : null));

        setTimeout(() => input.focus(), 50);
    });
}

function getFolderTypeForUI(tag, notes) {
    return (tag.folder_type === "CLOSED" && notes?.tagPrivate?.[tag.id]) ? "PRIVATE" : tag.folder_type || "NONE";
}

function parseSearchGroups(input) {
    return input.split(',').map(g => g.match(/(?:[^\s"]+|"[^"]*")+/g) || []);
}

function parseSearchTerm(term) {
    let positive = !term.startsWith('-');
    term = term.replace(/^-/, '').trim();
    const m = term.match(/^([taf]):(.+)$/i);
    return m ? { field: m[1].toLowerCase(), value: m[2].toLowerCase(), positive } : { field: '', value: term, positive };
}

async function hashPin(pin) {
    const data = new TextEncoder().encode(pin);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function getStoredPinHash() {
    ensureContext();
    // create the bucket if it isn’t there
    if (!context.extensionSettings.stcm) context.extensionSettings.stcm = {};
    return context.extensionSettings.stcm.pinHash ?? "";
}

function saveStoredPinHash(hash) {
    ensureContext();
    // create the bucket if it isn’t there
    if (!context.extensionSettings.stcm) context.extensionSettings.stcm = {};
    context.extensionSettings.stcm.pinHash = hash;
    context.saveSettingsDebounced();
}


// Helper: Hex to RGBA (supports #rgb, #rrggbb, or rgb/rgba)
function hexToRgba(hex, alpha) {
    if (hex.startsWith('rgb')) {
        return hex.replace(')', `, ${alpha})`);
    }
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r},${g},${b},${alpha})`;
}

const origEmit = eventSource.emit;

eventSource.emit = function(event, ...args) {
    if (isDevMode()) {
    console.log('[EVENT]', event, ...args);
    }

    if (event === 'chatLoaded') {
        setTimeout(() => {
            try {
                createSwipeSelector();
            } catch (err) {
                if (isDevMode()) {
                console.warn('Swipe selector injection failed:', err);
                }
            }
        }, 50);
    }

    if (event === 'message_sent' || event === 'user_message_rendered') {
        const selector = document.querySelector('.swipe-selector-container');
        if (selector) {
            selector.querySelector('button').disabled = true;
            selector.title = 'Disabled after message was sent';
        }
    }

    if (event === 'message_deleted') {
        setTimeout(() => {
            try {
                const selector = document.querySelector('.swipe-selector-container');
                const mesCount = document.querySelectorAll('#chat .mes').length;

                if (mesCount === 1) {
                    // Re-enable or inject
                    if (!selector) {
                        createSwipeSelector();
                    } else {
                        selector.querySelector('button').disabled = false;
                        selector.title = '';
                    }
                } else {
                    if (selector) {
                        selector.querySelector('button').disabled = true;
                        selector.title = 'Disabled after message was sent';
                    }
                }
            } catch (err) {
                if (isDevMode()) {
                console.warn('Swipe selector update on message_deleted failed:', err);
                }
            }
        }, 50);
    }

    if (event === 'app_ready') {
        setTimeout(() => {
          try { window.STCM_feedbackTrigger?.fire('app_ready'); } catch {}
        }, 0);
      }

    return origEmit.apply(this, arguments);
};

function createSwipeSelector() {
    ensureContext();
    const chat = context.chat;
    if (!Array.isArray(chat) || chat.length !== 1) return;

    const firstMsg = chat[0];
    const swipes = firstMsg.swipes;
    if (!Array.isArray(swipes) || swipes.length <= 1) return;

    const mesDiv = document.querySelector('#chat .mes[mesid="0"]');
    if (!mesDiv || mesDiv.querySelector('.swipe-selector-container')) return;

    const mesBlock = mesDiv.querySelector('.mes_block');
    const chNameBlock = mesBlock?.querySelector('.ch_name');
    if (!mesBlock || !chNameBlock) return;

    // Create container
    const container = document.createElement('div');
    container.className = 'swipe-selector-container';
    container.style.margin = '4px 0 8px 0';

    // Create button
    const button = document.createElement('button');
    button.textContent = 'Choose Alt Greeting';
    button.style.padding = '4px 10px';
    button.style.background = '#333';
    button.style.color = '#fff';
    button.style.border = '1px solid #666';
    button.style.borderRadius = '4px';
    button.style.cursor = 'pointer';

    container.appendChild(button);
    mesBlock.insertBefore(container, chNameBlock);

    button.addEventListener('click', () => {
        // Ensure swipe_info is valid
        if (!Array.isArray(firstMsg.swipe_info)) firstMsg.swipe_info = [];
        while (firstMsg.swipe_info.length < swipes.length) {
            firstMsg.swipe_info.push({
                send_date: firstMsg.send_date,
                gen_started: firstMsg.gen_started ?? null,
                gen_finished: firstMsg.gen_finished ?? null,
                extra: structuredClone(firstMsg.extra ?? {})
            });
        }

        const modal = document.createElement('div');
        modal.className = 'swipe-modal';
        Object.assign(modal.style, {
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: '#1c1c1c',
            border: '1px solid #555',
            padding: '20px',
            zIndex: '10001',
            maxHeight: '80vh',
            overflowY: 'auto',
            maxWidth: '600px',
            width: '90%',
            borderRadius: '8px',
            boxShadow: '0 0 10px rgba(0,0,0,0.5)'
        });

        const header = document.createElement('div');
        header.textContent = 'Select an Alternate Greeting';
        Object.assign(header.style, {
            fontSize: '1.1em',
            marginBottom: '12px',
            color: '#fff'
        });
        modal.appendChild(header);

        const searchInput = document.createElement('input');
        Object.assign(searchInput.style, {
            width: '100%',
            padding: '6px 8px',
            marginBottom: '12px',
            fontSize: '14px',
            border: '1px solid #555',
            borderRadius: '4px',
            background: '#2c2c2c',
            color: '#fff',
        });
        searchInput.placeholder = 'Search alternate greetings...';
        modal.appendChild(searchInput);


        const swipeList = document.createElement('div');
        modal.appendChild(swipeList);

        const swipeContainers = [];

        swipes.forEach((text, idx) => {
            const swipeContainer = document.createElement('div');
            Object.assign(swipeContainer.style, {
                marginBottom: '16px',
                border: '1px solid #444',
                borderRadius: '6px',
                padding: '10px',
                background: '#2a2a2a'
            });

            const swipeText = document.createElement('div');
            swipeText.innerHTML = messageFormatting(
                text,
                firstMsg.name ?? '',
                !!firstMsg.is_system,
                !!firstMsg.is_user,
                0
            );
            Object.assign(swipeText.style, {
                whiteSpace: 'pre-wrap',
                color: '#ddd',
                marginBottom: '10px',
                maxHeight: '100px',
                overflowY: 'auto',
                paddingRight: '4px',
                scrollbarWidth: 'thin'
            });

            const useBtn = document.createElement('button');
            useBtn.textContent = idx === 0 ? 'Use First Message' : `Use Alt ${idx}`;
            Object.assign(useBtn.style, {
                padding: '4px 8px',
                background: '#007acc',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
            });

            useBtn.addEventListener('click', () => {
                firstMsg.swipe_id = idx;
                if (typeof syncSwipeToMes === 'function') {
                    syncSwipeToMes(0, idx);
                } else {
                    firstMsg.mes = swipes[idx];
                }

                if (mesDiv) {
                    const mesText = mesDiv.querySelector('.mes_text');
                    if (mesText && typeof messageFormatting === 'function') {
                        const formatted = messageFormatting(
                            firstMsg.mes,
                            firstMsg.name ?? '',
                            !!firstMsg.is_system,
                            !!firstMsg.is_user,
                            0
                        );
                        mesText.innerHTML = formatted;
                    }
                }

                document.body.removeChild(modal);
                overlay.remove();
            });

            swipeContainer.appendChild(swipeText);
            swipeContainer.appendChild(useBtn);

            swipeContainers.push({ text, element: swipeContainer });
            swipeList.appendChild(swipeContainer);
        });

        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(0,0,0,0.6)',
            zIndex: '10000'
        });
        overlay.addEventListener('click', () => {
            document.body.removeChild(modal);
            overlay.remove();
        });

        searchInput.addEventListener('input', () => {
            const query = searchInput.value.toLowerCase();
            swipeContainers.forEach(({ text, element }) => {
                const plainText = text.toLowerCase();
                element.style.display = plainText.includes(query) ? '' : 'none';
            });
        });
        

        document.body.appendChild(overlay);
        document.body.appendChild(modal);
    });
}

// --- Canonical counts (folders, tags, characters) ---
function getFolderCount() {
    try {
        const arr = Array.isArray(STCM?.sidebarFolders) ? STCM.sidebarFolders : [];
        // Exclude the synthetic root container if present
        return arr.filter(f => f && f.id !== 'root').length;
    } catch {
        return 0;
    }
}

function getTagCount() {
    try {
        return Array.isArray(tags) ? tags.length : 0;
    } catch {
        return 0;
    }
}

function getCharacterCount() {
    try {
        const entities = typeof getEntitiesList === "function" ? getEntitiesList() : [];
        // Count unique characters (by avatar/id), ignore groups
        const ids = new Set();
        for (const e of entities) {
            if (e?.type === "character") {
                const id = e.item?.avatar ?? e.avatar ?? e.item?.id ?? e.id;
                if (id !== undefined) ids.add(id);
            }
        }
        return ids.size;
    } catch {
        return 0;
    }
}


export {
    debounce, debouncePersist, flushExtSettings, getFreeName, isNullColor, escapeHtml, getCharacterNameById, stcm_saveCharacter,
    resetModalScrollPositions, makeModalDraggable, saveModalPosSize, clampModalSize, restoreCharEditModal,
    cleanTagMap, buildTagMap,
    buildCharNameMap, getNotes, saveNotes,
    watchTagFilterBar, promptInput, getFolderTypeForUI, parseSearchGroups, parseSearchTerm, 
    hashPin, getStoredPinHash, saveStoredPinHash, hexToRgba,
    createSwipeSelector,
    getCharacterCount, getFolderCount, getTagCount,
    addTagMapBackup, tryAutoBackupTagMapOnLaunch,
    isDevMode
};
