// stcm_char_field_editor.js
// SillyTavern Character Manager – Character Field Editor Workshop
// Opens a modal with LLM integration to edit individual character fields

let ctx = null;
function ensureCtx() {
    if (!ctx) ctx = SillyTavern.getContext();
    ctx.extensionSettings ??= {};
    ctx.extensionSettings.stcm ??= {};
}

// Character field definitions - what fields can be edited and their display info
const CHARACTER_FIELDS = [
    { key: 'name', label: 'Name', multiline: false, category: 'basics', readonly: false },
    { key: 'description', label: 'Description', multiline: true, category: 'basics', readonly: false },
    { key: 'personality', label: 'Personality', multiline: true, category: 'basics', readonly: false },
    { key: 'scenario', label: 'Scenario', multiline: true, category: 'basics', readonly: false },
    { key: 'first_mes', label: 'First Message', multiline: true, category: 'basics', readonly: false },
    { key: 'mes_example', label: 'Examples of Dialogue', multiline: true, category: 'basics', readonly: false },
    { key: 'alternate_greetings', label: 'Alternate Greetings', multiline: true, category: 'basics', readonly: false, isArray: true },
    { key: 'data.system_prompt', label: 'Main Prompt', multiline: true, category: 'advanced', readonly: false },
    { key: 'data.post_history_instructions', label: 'Post-History Instructions', multiline: true, category: 'advanced', readonly: false },
    { key: 'data.extensions.depth_prompt.prompt', label: 'Character Note', multiline: false, category: 'advanced', readonly: false },
    { key: 'data.creator', label: 'Created by', multiline: false, category: 'metadata', readonly: false },
    { key: 'data.creator_notes', label: "Creator's Notes", multiline: true, category: 'metadata', readonly: false },
];

// Store workshop state
let currentCharacter = null;
let selectedFields = new Set(); // Fields to edit
let contextFields = new Set();  // Fields to include as context
let miniTurns = [];

// Persist per character so sessions don't collide
const STATE_KEY = () => {
    const id = currentCharacter?.avatar || 'global';
    return `stcm_field_editor_state_${id}`;
};

function saveSession_cfe() {
    try {
        const state = {
            selectedFields: Array.from(selectedFields),
            contextFields: Array.from(contextFields),
            miniTurns: miniTurns
        };
        localStorage.setItem(STATE_KEY(), JSON.stringify(state));
    } catch (e) {
        console.warn('[STCM Field Editor] Save session failed:', e);
    }
}



function loadSession_cfe() {
    try {
        const stored = localStorage.getItem(STATE_KEY());
        if (stored) {
            const state = JSON.parse(stored);
            selectedFields = new Set(state.selectedFields || []);
            contextFields = new Set(state.contextFields || []);
            miniTurns = state.miniTurns || [];
        }
    } catch (e) {
        console.warn('[STCM Field Editor] Load session failed:', e);
        selectedFields = new Set();
        contextFields = new Set();
        miniTurns = [];
    }
}



// Helper functions
function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
}

function mkBtn(label, variant) {
    const b = el('button', 'stcm-gw-btn' + (variant ? ` stcm-gw-btn--${variant}` : ''), label);
    return b;
}

function spacer() { 
    const s = document.createElement('div'); 
    s.style.flex = '1'; 
    return s; 
}

// Get field value from character object using dot notation
function getFieldValue(char, fieldKey) {
    if (fieldKey === 'alternate_greetings') {
        // Handle alternate greetings - check both root level and data.alternate_greetings
        const greetings = char?.data?.alternate_greetings || char?.alternate_greetings || [];
        if (!Array.isArray(greetings)) return '';
        
        const messages = greetings.map(greeting => {
            if (typeof greeting === 'object' && greeting.mes !== undefined) {
                return greeting.mes;
            }
            return greeting || '';
        });
        
        return messages.join('\n\n---\n\n');
    }
    
    // Handle individual alternate greetings and their mes property
    if (fieldKey.startsWith('alternate_greetings[')) {
        const match = fieldKey.match(/alternate_greetings\[(\d+)\](?:\.mes)?/);
        if (match) {
            const index = parseInt(match[1]);
            const greetings = char?.data?.alternate_greetings || char?.alternate_greetings || [];
            const greeting = greetings[index];
            
            // If accessing .mes property or the greeting is an object with mes
            if (fieldKey.includes('.mes') || (greeting && typeof greeting === 'object' && greeting.mes !== undefined)) {
                return greeting?.mes || '';
            }
            // Otherwise return the full greeting (backward compatibility)
            return greeting || '';
        }
    }
    
    // Handle root-level fields that might also exist in data
    if (['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example'].includes(fieldKey)) {
        // Use data field if available, otherwise fall back to root level
        return char?.data?.[fieldKey] || char?.[fieldKey] || '';
    }
    
    const keys = fieldKey.split('.');
    let value = char;
    for (const key of keys) {
        value = value?.[key];
    }
    return value || '';
}

// Set field value in character object using dot notation
function setFieldValue(char, fieldKey, newValue) {
    if (fieldKey === 'alternate_greetings') {
        // Handle alternate greetings as array, creating objects with .mes property
        const messages = newValue ? newValue.split('\n\n---\n\n').map(g => g.trim()).filter(g => g) : [];
        const greetings = messages.map(mes => ({ mes }));
        
        // Set in both locations to ensure compatibility
        if (!char.data) char.data = {};
        char.data.alternate_greetings = greetings;
        char.alternate_greetings = greetings;
        return;
    }
    
    // Handle individual alternate greetings and their mes property
    if (fieldKey.startsWith('alternate_greetings[')) {
        const match = fieldKey.match(/alternate_greetings\[(\d+)\](?:\.mes)?/);
        if (match) {
            const index = parseInt(match[1]);
            if (!char.data) char.data = {};
            if (!char.data.alternate_greetings) char.data.alternate_greetings = [];
            if (!char.alternate_greetings) char.alternate_greetings = [];
            
            // Ensure the greeting object exists in both locations
            while (char.data.alternate_greetings.length <= index) {
                char.data.alternate_greetings.push({ mes: '' });
            }
            while (char.alternate_greetings.length <= index) {
                char.alternate_greetings.push({ mes: '' });
            }
            
            // Set identical values in both locations
            char.data.alternate_greetings[index] = { mes: newValue };
            char.alternate_greetings[index] = { mes: newValue };
            return;
        }
    }
    
    // Shared fields between root level and data object (per TavernCard spec)
    const SHARED_SPEC_FIELDS = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example'];
    
    if (SHARED_SPEC_FIELDS.includes(fieldKey)) {
        // Ensure data object exists
        if (!char.data) char.data = {};
        
        // Set IDENTICAL values in both locations - this prevents spec mismatches
        char[fieldKey] = newValue;
        char.data[fieldKey] = newValue;
        
        // Ensure spec metadata is present and consistent
        const currentSpec = char.spec || char.data?.spec || 'chara_card_v2';
        const currentSpecVersion = char.spec_version || char.data?.spec_version || '2.0';
        
        char.spec = currentSpec;
        char.spec_version = currentSpecVersion;
        char.data.spec = currentSpec;
        char.data.spec_version = currentSpecVersion;
        
        return;
    }
    
    // Handle nested data fields (like data.creator, data.system_prompt, etc.)
    if (fieldKey.startsWith('data.')) {
        if (!char.data) char.data = {};
        const dataPath = fieldKey.substring(5); // Remove 'data.' prefix
        const keys = dataPath.split('.');
        let target = char.data;
        
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!target[key]) target[key] = {};
            target = target[key];
        }
        
        target[keys[keys.length - 1]] = newValue;
        return;
    }
    
    // Handle other root-level fields
    char[fieldKey] = newValue;
}

// Build the system prompt for character field editing
function buildSystemPrompt() {
    ensureCtx();
    const charName = currentCharacter?.name || '{{char}}';
    const selectedFieldsList = Array.from(selectedFields).map(key => {
        const field = CHARACTER_FIELDS.find(f => f.key === key);
        return field ? field.label : key;
    }).join(', ');

    const contextFieldsList = Array.from(contextFields).map(key => {
        const field = CHARACTER_FIELDS.find(f => f.key === key);
        return field ? field.label : key;
    }).join(', ');

    const currentData = buildCharacterData();

    return [
        `You are a Character Development Assistant helping to edit character card fields for "${charName}".`,
        '',
        `FIELDS TO EDIT: ${selectedFieldsList}`,
        contextFields.size > 0 ? `CONTEXT FIELDS (reference only): ${contextFieldsList}` : '',
        '',
        'INSTRUCTIONS:',
        '• Read the user\'s request carefully and edit ONLY the requested fields',
        '• Use the context fields for reference and consistency, but do NOT modify them',
        '• Maintain character consistency across all fields',
        '• Keep the character\'s core personality and voice intact unless specifically asked to change it',
        '• For character descriptions, be detailed but not overly verbose',
        '• For personality fields, use clear, actionable traits',
        '• For scenarios, set up engaging situations that showcase the character',
        '• For dialogue examples, match the character\'s speaking style and personality',
        '• For first messages, create engaging opening scenes that draw the user in',
        '• For alternate greetings (bulk), create varied opening scenarios separated by "\\n\\n---\\n\\n"',
        '• For individual alternate greeting messages (alternate_greetings[0].mes, etc.), edit specific greeting text',
        '• When creating new alternate greetings, they will be formatted as objects with "mes" property',
        '',
        'RESPONSE FORMAT:',
        'Return ONLY a valid JSON object with the field keys and new values. Use the exact field keys shown in the current data below.',
        '',
        'Example response format:',
        '{',
        '  "description": "New description text...",',
        '  "personality": "Updated personality traits...",',
        '  "scenario": "New scenario setup...",',
        '  "alternate_greetings": "First greeting...\\n\\n---\\n\\nSecond greeting...",',
        '  "alternate_greetings[0].mes": "Specific message for first greeting...",',
        '  "alternate_greetings[1].mes": "Specific message for second greeting..."',
        '}',
        '',
        'CRITICAL RULES:',
        '• Return ONLY the JSON object - no explanations, no markdown formatting, no additional text',
        '• Do NOT wrap the JSON in code blocks (```json or ```)',
        '• Include ONLY the fields that are being edited (not context fields)',
        '• Ensure all JSON strings are properly escaped',
        '• If editing dialogue examples, use proper dialogue formatting with quotes and actions',
        '• Maintain appropriate content rating and avoid inappropriate content',
        '• NEVER replace or modify template variables like {{char}}, {{user}}, <start>, <START>, etc. - keep them exactly as they are',
        '• Template variables are important placeholders and must be preserved in their original form',
        '',
        'CURRENT CHARACTER DATA:',
        JSON.stringify(currentData, null, 2),
        '',
        'USER REQUEST:'
    ].join('\n');
}

// Build character data object for the LLM
function buildCharacterData() {
    if (!currentCharacter) return {};
    
    const data = {};
    selectedFields.forEach(fieldKey => {
        const value = getFieldValue(currentCharacter, fieldKey);
        data[fieldKey] = value;
    });
    
    return data;
}

// Main workshop UI functions
function openFieldEditor(character) {
    ensureCtx();
    if (!character) {
        console.warn('[STCM Field Editor] No character provided');
        return;
    }

    currentCharacter = character;

    loadSession_cfe();
    
    // Find the character edit modal
    const editModalId = `stcmCharEditModal-${character.avatar}`;
    const editModal = document.getElementById(editModalId);
    
    if (!editModal) {
        toastr.error('Character edit modal not found. Please open the character edit panel first.');
        return;
    }

    // Check if field editor is already open
    const existingFieldEditor = editModal.querySelector('.stcm-field-editor-panel');
    if (existingFieldEditor) {
        // Toggle off if already open
        closeFieldEditor();
        return;
    }

    // Sync selections from main panel checkboxes
    syncFieldSelectionsFromMainPanel();

    // Create the field editor panel
    const fieldEditorPanel = createFieldEditorPanel();
    
    // Add the panel to the edit modal
    const modalBody = editModal.querySelector('.modalBody');
    if (modalBody) {
        // Make the modal body flex to accommodate the side panel
        modalBody.style.display = 'flex';
        modalBody.style.gap = '16px';
        
        // Make the existing content take up remaining space
        const existingContent = modalBody.firstElementChild;
        if (existingContent) {
            existingContent.style.flex = '1';
            existingContent.style.minWidth = '0'; // Prevent overflow
        }
        
        // Add the field editor panel
        modalBody.appendChild(fieldEditorPanel);
        
        // Expand the modal to accommodate the side panel
        expandModalForFieldEditor(editModal);
        
        // Show checkboxes when field editor opens
        toggleFieldEditorCheckboxes(editModal, true);
    }

    // Add event listener for field selection sync
    const syncHandler = () => {
        syncFieldSelectionsFromMainPanel();
        const fieldSection = fieldEditorPanel.querySelector('.stcm-field-selection-section');
        if (fieldSection && fieldSection.updateSelectionStatus) {
            fieldSection.updateSelectionStatus();
        }
    };
    document.addEventListener('stcm-sync-field-selections', syncHandler);
    
    // Store the handler for cleanup
    fieldEditorPanel.syncHandler = syncHandler;

    // Initialize UI
    restoreUIFromState();
    
    // Field data is automatically current via buildCharacterData()
}

function syncFieldSelectionsFromMainPanel() {
    if (!currentCharacter) return;
    
    const editModalId = `stcmCharEditModal-${currentCharacter.avatar}`;
    const editModal = document.getElementById(editModalId);
    
    if (!editModal) return;
    
    // Clear existing selections
    selectedFields.clear();
    contextFields.clear();
    
    // Find all checked edit checkboxes
    const editCheckboxes = editModal.querySelectorAll('.stcm-edit-checkbox:checked');
    editCheckboxes.forEach(checkbox => {
        const fieldKey = checkbox.dataset.fieldKey;
        if (fieldKey) selectedFields.add(fieldKey);
    });
    
    // Find all checked context checkboxes
    const contextCheckboxes = editModal.querySelectorAll('.stcm-context-checkbox:checked');
    contextCheckboxes.forEach(checkbox => {
        const fieldKey = checkbox.dataset.fieldKey;
        if (fieldKey) contextFields.add(fieldKey);
    });
    
    // Save the synced selections
    saveSession_cfe();
}

function closeFieldEditor() {
    if (!currentCharacter) return;
    
    const editModalId = `stcmCharEditModal-${currentCharacter.avatar}`;
    const editModal = document.getElementById(editModalId);
    
    if (editModal) {
        const fieldEditorPanel = editModal.querySelector('.stcm-field-editor-panel');
        if (fieldEditorPanel) {
            // Clean up event listener
            if (fieldEditorPanel.syncHandler) {
                document.removeEventListener('stcm-sync-field-selections', fieldEditorPanel.syncHandler);
                delete fieldEditorPanel.syncHandler;
            }
            
            fieldEditorPanel.remove();
            
            // Restore modal body layout
            const modalBody = editModal.querySelector('.modalBody');
            if (modalBody) {
                modalBody.style.display = '';
                modalBody.style.gap = '';
                
                const existingContent = modalBody.firstElementChild;
                if (existingContent) {
                    existingContent.style.flex = '';
                    existingContent.style.minWidth = '';
                }
            }
            
            // Restore modal size
            restoreModalFromFieldEditor(editModal);
            
            // Hide checkboxes when field editor closes
            toggleFieldEditorCheckboxes(editModal, false);
        }
    }
    
    // Clear state
    currentCharacter = null;
    selectedFields.clear(); 
    contextFields.clear();  
    miniTurns.length = 0;   
}

// Toggle visibility of field editor checkboxes
function toggleFieldEditorCheckboxes(modal, show) {
    if (!modal) return;
    
    const checkboxContainers = modal.querySelectorAll('.stcm-field-checkboxes, .stcm-alt-field-checkboxes');
    checkboxContainers.forEach(container => {
        container.style.display = show ? 'flex' : 'none';
    });
}

function createFieldEditorPanel() {
    const panel = el('div', 'stcm-field-editor-panel');
    panel.style.width = '400px';
    panel.style.minWidth = '400px';
    panel.style.maxWidth = '500px';
    panel.style.borderLeft = '1px solid var(--stcm-gw-border)';
    panel.style.paddingLeft = '16px';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.height = '100%';
    panel.style.backgroundColor = 'var(--stcm-gw-bg)';

    // Header
    const header = el('div', 'stcm-field-editor-header');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.marginBottom = '16px';
    header.style.paddingBottom = '8px';
    header.style.borderBottom = '1px solid var(--stcm-gw-border)';

    const title = el('h3', null, '🎭 AI Field Editor');
    title.style.margin = '0';
    title.style.fontSize = '16px';

    const closeBtn = mkBtn('×', 'danger');
    closeBtn.style.padding = '4px 8px';
    closeBtn.style.fontSize = '16px';
    closeBtn.addEventListener('click', closeFieldEditor);

    header.append(title, closeBtn);

    // Field selection section
    const fieldSection = createFieldSelectionSection();
    fieldSection.style.flex = '0 0 auto';
    fieldSection.style.maxHeight = '40%';
    fieldSection.style.overflowY = 'auto';
    fieldSection.style.marginBottom = '16px';

    // Chat section
    const chatSection = createChatSection();
    chatSection.style.flex = '1';
    chatSection.style.minHeight = '0';

    panel.append(header, fieldSection, chatSection);
    return panel;
}

function createFieldSelectionSection() {
    const section = el('div', 'stcm-field-selection-section');
    section.style.borderBottom = '1px solid #444';
    section.style.paddingBottom = '12px';
    section.style.marginBottom = '12px';

    // Simple status display
    const statusContainer = el('div', 'stcm-selection-status');
    statusContainer.style.cssText = `
        background: #1a1a1a;
        border: 1px solid #333;
        border-radius: 4px;
        padding: 12px;
    `;

    const title = el('h4', null, 'Selected Fields');
    title.style.margin = '0 0 8px 0';
    title.style.fontSize = '14px';
    title.style.color = '#fff';

    const editStatus = el('div', 'stcm-edit-status');
    editStatus.style.cssText = `
        margin-bottom: 8px;
        padding: 6px;
        background: #2a2a2a;
        border-radius: 3px;
        border-left: 3px solid #4a9eff;
    `;

    const contextStatus = el('div', 'stcm-context-status');
    contextStatus.style.cssText = `
        padding: 6px;
        background: #2a2a2a;
        border-radius: 3px;
        border-left: 3px solid #ffaa4a;
    `;

    const instructions = el('div', 'stcm-instructions');
    instructions.style.cssText = `
        margin-top: 12px;
        padding: 8px;
        background: #2a4a2a;
        border-radius: 3px;
        font-size: 11px;
        color: #aaa;
        line-height: 1.4;
        font-size: .9em;
    `;
    instructions.innerHTML = `
        <strong>How to use:</strong><br>
        1. Use the checkboxes in the main character edit panel<br>
        2. Select fields for <span style="color: #4a9eff;">Edit</span> (modify) or <span style="color: #ffaa4a;">Context</span> (reference)<br>
    `;

    // Select All buttons container
    const selectAllContainer = el('div', 'stcm-select-all-container');
    selectAllContainer.style.cssText = `
        margin-top: 8px;
        display: flex;
        gap: 4px;
    `;

    const selectAllEditBtn = mkBtn('Select All Edit', 'ok');
    selectAllEditBtn.style.cssText = 'padding: 4px 8px; font-size: 11px; flex: 1;';
    selectAllEditBtn.addEventListener('click', () => {
        selectAllFields('edit');
        updateSelectionStatus();
    });

    const selectAllContextBtn = mkBtn('Select All Context', 'accent');
    selectAllContextBtn.style.cssText = 'padding: 4px 8px; font-size: 11px; flex: 1;';
    selectAllContextBtn.addEventListener('click', () => {
        selectAllFields('context');
        updateSelectionStatus();
    });

    const clearAllBtn = mkBtn('Clear All', 'warn');
    clearAllBtn.style.cssText = 'padding: 4px 8px; font-size: 11px; flex: 1;';
    clearAllBtn.addEventListener('click', () => {
        clearAllFields();
        updateSelectionStatus();
    });

    selectAllContainer.append(selectAllEditBtn, selectAllContextBtn, clearAllBtn);

    // Helper functions for field selection
    function selectAllFields(type) {
        if (!currentCharacter) return;
        
        const editModalId = `stcmCharEditModal-${currentCharacter.avatar}`;
        const editModal = document.getElementById(editModalId);
        if (!editModal) return;

        // Define fields to exclude
        const excludeFields = [
            // Prompt overrides
            'data.system_prompt',
            'data.post_history_instructions', 
            'data.extensions.depth_prompt.prompt',
            'data.extensions.depth_prompt.depth',
            'data.extensions.depth_prompt.role',
            // Creator's metadata
            'data.creator',
            'data.creator_notes'
        ];

        // Get all available fields from CHARACTER_FIELDS, excluding specified ones
        const fieldsToSelect = CHARACTER_FIELDS
            .filter(field => !excludeFields.includes(field.key))
            .map(field => field.key);

        // Also get alternate greetings if they exist
        const altGreetings = currentCharacter?.alternate_greetings || [];
        const altFields = altGreetings.map((_, idx) => `alternate_greetings[${idx}].mes`);

        const allFields = [...fieldsToSelect, ...altFields];

        // Select checkboxes based on type
        const checkboxSelector = type === 'edit' ? '.stcm-edit-checkbox' : '.stcm-context-checkbox';
        const targetSet = type === 'edit' ? selectedFields : contextFields;

        // Clear existing selections of this type
        targetSet.clear();

        // Check all relevant checkboxes
        allFields.forEach(fieldKey => {
            const checkbox = editModal.querySelector(`${checkboxSelector}[data-field-key="${fieldKey}"]`);
            if (checkbox) {
                checkbox.checked = true;
                targetSet.add(fieldKey);
            }
        });

        // Save selections
        saveSession_cfe();
        
        toastr.success(`Selected ${allFields.length} fields for ${type} (excluding prompt overrides and metadata)`);
    }

    function clearAllFields() {
        if (!currentCharacter) return;
        
        const editModalId = `stcmCharEditModal-${currentCharacter.avatar}`;
        const editModal = document.getElementById(editModalId);
        if (!editModal) return;

        // Uncheck all checkboxes
        const allCheckboxes = editModal.querySelectorAll('.stcm-edit-checkbox, .stcm-context-checkbox');
        allCheckboxes.forEach(checkbox => {
            checkbox.checked = false;
        });

        // Clear selections
        selectedFields.clear();
        contextFields.clear();

        // Save selections
        saveSession_cfe();
        
        toastr.success('Cleared all field selections');
    }

    function updateSelectionStatus() {
        const editCount = selectedFields.size;
        const contextCount = contextFields.size;

        editStatus.innerHTML = `
            <strong>Fields to Edit (${editCount}):</strong><br>
            <span style="font-size: 11px; color: #ddd;">
                ${editCount === 0 ? 'None selected' : Array.from(selectedFields).join(', ')}
            </span>
        `;

        contextStatus.innerHTML = `
            <strong>Context Fields (${contextCount}):</strong><br>
            <span style="font-size: 11px; color: #ddd;">
                ${contextCount === 0 ? 'None selected' : Array.from(contextFields).join(', ')}
            </span>
        `;
    }

    statusContainer.append(title, editStatus, contextStatus, instructions, selectAllContainer);
    section.appendChild(statusContainer);

    // Store update function for later use
    section.updateSelectionStatus = updateSelectionStatus;
    
    // Initialize status display
    updateSelectionStatus();

    return section;
}



function createChatSection() {
    const section = el('div', 'stcm-chat-section');
    section.style.display = 'flex';
    section.style.flexDirection = 'column';
    section.style.height = '100%';
    section.style.minHeight = '400px';
    section.style.maxHeight = '600px';

    const chatLog = el('div', 'stcm-gw-log stcm-scroll');
    chatLog.style.flex = '1';
    chatLog.style.overflowY = 'auto';
    chatLog.style.marginBottom = '12px';
    chatLog.style.border = '1px solid var(--stcm-gw-border)';
    chatLog.style.borderRadius = '6px';
    chatLog.style.padding = '12px';
    chatLog.style.backgroundColor = '#1a1a1a';
    chatLog.style.minHeight = '200px';

    const composer = el('div', 'stcm-gw-composer');
    composer.style.display = 'flex';
    composer.style.flexDirection = 'column';
    composer.style.gap = '8px';

    const input = el('textarea', 'stcm-gw-ta');
    input.style.minHeight = '60px';
    input.style.resize = 'vertical';
    input.style.fontSize = '13px';
    input.placeholder = 'Describe how to edit the selected fields...';

    const buttonRow = el('div', 'stcm-button-row');
    buttonRow.style.display = 'flex';
    buttonRow.style.gap = '6px';

    const sendBtn = mkBtn('Send', 'ok');
    const regenBtn = mkBtn('Regen', 'info');
    const clearBtn = mkBtn('Clear', 'warn');
    sendBtn.style.padding = '6px 12px';
    sendBtn.style.fontSize = '12px';
    regenBtn.style.padding = '6px 12px';
    regenBtn.style.fontSize = '12px';
    clearBtn.style.padding = '6px 12px';
    clearBtn.style.fontSize = '12px';
    
    sendBtn.addEventListener('click', () => onSendToLLM(false));
    regenBtn.addEventListener('click', () => onSendToLLM(true));
    clearBtn.addEventListener('click', () => onClearConversation());

    buttonRow.append(sendBtn, regenBtn, clearBtn);
    composer.append(input, buttonRow);

    section.append(chatLog, composer);
    return section;
}

function expandModalForFieldEditor(editModal) {
    // Store original size for restoration
    if (!editModal.dataset.originalWidth) {
        const style = window.getComputedStyle(editModal);
        editModal.dataset.originalWidth = style.width;
        editModal.dataset.originalMaxWidth = style.maxWidth || '';
    }
    
    // Expand the modal
    editModal.style.width = 'min(1400px, 95vw)';
    editModal.style.maxWidth = '95vw';
}

function restoreModalFromFieldEditor(editModal) {
    // Restore original size
    if (editModal.dataset.originalWidth) {
        editModal.style.width = editModal.dataset.originalWidth;
        editModal.style.maxWidth = editModal.dataset.originalMaxWidth || '';
        
        delete editModal.dataset.originalWidth;
        delete editModal.dataset.originalMaxWidth;
    }
}





function restoreUIFromState() {
    if (!currentCharacter) return;
    
    const editModalId = `stcmCharEditModal-${currentCharacter.avatar}`;
    const editModal = document.getElementById(editModalId);
    const chatLog = editModal?.querySelector('.stcm-gw-log');
    
    if (!chatLog) return;

    // Clear the DOM log
    chatLog.innerHTML = '';

    // Add initial message
    appendBubble('assistant', 'Select fields to edit and optional context fields for reference, then describe how you want to modify them.', { noActions: true });

    // Restore saved turns
    for (const turn of miniTurns) {
        appendBubble(turn.role, turn.content, { ts: turn.ts });
    }

    chatLog.scrollTop = chatLog.scrollHeight;
}

function appendBubble(role, text, opts = {}) {
    if (!currentCharacter) return;
    
    const editModalId = `stcmCharEditModal-${currentCharacter.avatar}`;
    const editModal = document.getElementById(editModalId);
    const chatLog = editModal?.querySelector('.stcm-gw-log');
    
    if (!chatLog) return;

    const wrap = el('div', 'gw-row');
    wrap.dataset.role = role;
    wrap.dataset.ts = opts.ts || Date.now();

    const bubble = el('div', `gw-bubble gw-bubble--${role}`);
    const content = el('div', 'gw-content');
    
    // Check if this is a JSON response and format it nicely
    if (role === 'assistant' && !opts.noActions) {
        const formattedJson = formatJsonResponse(text);
        if (formattedJson) {
            content.appendChild(formattedJson);
        } else {
            content.textContent = text;
        }
    } else {
        content.textContent = text;
    }

    bubble.appendChild(content);

    // Add action buttons for assistant messages
    if (role === 'assistant' && !opts.noActions) {
        const bar = el('div', 'gw-action-bar');
        bar.style.display = 'flex';
        bar.style.gap = '6px';
        bar.style.marginTop = '6px';

        const applyBtn = mkBtn('Apply', 'warn');
        const copyBtn = mkBtn('Copy', 'info');
        const deleteBtn = mkBtn('Delete', 'ghost');
        applyBtn.style.fontSize = '11px';
        applyBtn.style.padding = '3px 6px';
        copyBtn.style.fontSize = '11px';
        copyBtn.style.padding = '3px 6px';
        deleteBtn.style.fontSize = '11px';
        deleteBtn.style.padding = '3px 6px';

        applyBtn.addEventListener('click', () => onApplyChanges(text));
        copyBtn.addEventListener('click', () => {
            const formattedText = formatJsonToText(text);
            navigator.clipboard.writeText(formattedText);
            toastr.success('Copied formatted text to clipboard');
        });
        deleteBtn.addEventListener('click', () => onDeleteMessage(wrap));

        bar.append(applyBtn, copyBtn, deleteBtn);
        bubble.appendChild(bar);
    }

    wrap.appendChild(bubble);
    chatLog.appendChild(wrap);
    chatLog.scrollTop = chatLog.scrollHeight;

    return wrap;
}

function formatJsonResponse(text) {
    try {
        const parsed = JSON.parse(text);
        
        // Create a formatted display
        const container = el('div', 'json-response');
        container.style.fontFamily = 'monospace';
        container.style.backgroundColor = '#222';
        container.style.border = '1px solid #444';
        container.style.borderRadius = '4px';
        container.style.padding = '12px';
        container.style.margin = '4px 0';
        
        Object.entries(parsed).forEach(([key, value]) => {
            const field = CHARACTER_FIELDS.find(f => f.key === key);
            const fieldName = field ? field.label : key;
            
            const fieldDiv = el('div', 'json-field');
            fieldDiv.style.marginBottom = '12px';
            fieldDiv.style.borderBottom = '1px solid #333';
            fieldDiv.style.paddingBottom = '8px';
            
            const fieldHeader = el('div', 'json-field-header');
            fieldHeader.style.color = '#4a9eff';
            fieldHeader.style.fontWeight = 'bold';
            fieldHeader.style.marginBottom = '6px';
            fieldHeader.style.fontSize = '13px';
            fieldHeader.textContent = `📝 ${fieldName}`;
            
            const fieldContent = el('div', 'json-field-content');
            fieldContent.style.color = '#ddd';
            fieldContent.style.fontSize = '12px';
            fieldContent.style.lineHeight = '1.4';
            fieldContent.style.whiteSpace = 'pre-wrap';
            fieldContent.style.paddingLeft = '16px';
            
            // Format the content nicely
            let displayValue = value;
            if (typeof value === 'string') {
                if (key === 'alternate_greetings') {
                    // Format alternate greetings with separators
                    displayValue = value.replace(/\n\n---\n\n/g, '\n\n🔄 ALTERNATE GREETING 🔄\n\n');
                } else {
                    // Replace newlines and format dialogue examples nicely
                    displayValue = value
                        .trim();
                }
            }
            
            fieldContent.textContent = displayValue;
            
            fieldDiv.append(fieldHeader, fieldContent);
            container.appendChild(fieldDiv);
        });
        
        return container;
    } catch (e) {
        // If it's not valid JSON, return null to fall back to plain text
        return null;
    }
}

function formatJsonToText(text) {
    try {
        const parsed = JSON.parse(text);
        let formattedText = '';
        
        Object.entries(parsed).forEach(([key, value], index) => {
            const field = CHARACTER_FIELDS.find(f => f.key === key);
            const fieldName = field ? field.label : key;
            
            if (index > 0) formattedText += '\n\n';
            formattedText += `=== ${fieldName.toUpperCase()} ===\n`;
            
            // Format the content nicely for copying
            let displayValue = value;
            if (typeof value === 'string') {
                if (key === 'alternate_greetings') {
                    // Format alternate greetings with clear separators
                    displayValue = value.replace(/\n\n---\n\n/g, '\n\n=== NEXT GREETING ===\n\n');
                } else {
                    // Clean up formatting for text copying
                    displayValue = value
                        .trim();
                }
            }
            
            formattedText += displayValue;
        });
        
        return formattedText;
    } catch (e) {
        // If it's not valid JSON, return the original text
        return text;
    }
}

function onDeleteMessage(messageWrap) {
    if (!currentCharacter || !messageWrap) return;
    
    const timestamp = messageWrap.dataset.ts;
    const role = messageWrap.dataset.role;
    
    if (!timestamp) return;
    
    // Find and remove the message from miniTurns
    const messageIndex = miniTurns.findIndex(turn => turn.ts == timestamp && turn.role === role);
    if (messageIndex !== -1) {
        miniTurns.splice(messageIndex, 1);
        
        // If we deleted an assistant message, also remove the preceding user message if it exists
        if (role === 'assistant' && messageIndex > 0) {
            const prevTurn = miniTurns[messageIndex - 1];
            if (prevTurn && prevTurn.role === 'user') {
                // Ask user if they want to remove the user message too
                const removeUserMsg = confirm('Also remove the user message that prompted this response?');
                if (removeUserMsg) {
                    miniTurns.splice(messageIndex - 1, 1);
                    
                    // Remove the user message from DOM
                    const editModalId = `stcmCharEditModal-${currentCharacter.avatar}`;
                    const editModal = document.getElementById(editModalId);
                    const chatLog = editModal?.querySelector('.stcm-gw-log');
                    const userMsgWrap = chatLog?.querySelector(`.gw-row[data-ts="${prevTurn.ts}"][data-role="user"]`);
                    if (userMsgWrap) {
                        userMsgWrap.remove();
                    }
                }
            }
        }
    }
    
    // Remove the message from DOM
    messageWrap.remove();
    
    // Save updated session
    saveSession_cfe();
    
    toastr.success('Message deleted');
}

function onClearConversation() {
    if (!currentCharacter) return;
    
    // Clear the conversation data
    miniTurns = [];
    
    // Clear the UI
    const editModalId = `stcmCharEditModal-${currentCharacter.avatar}`;
    const editModal = document.getElementById(editModalId);
    const chatLog = editModal?.querySelector('.stcm-gw-log');
    
    if (chatLog) {
        chatLog.innerHTML = '';
        // Add initial message
        appendBubble('assistant', 'Select fields to edit and optional context fields for reference, then describe how you want to modify them.', { noActions: true });
    }
    
    // Save the cleared state
    saveSession_cfe();
    
    toastr.success('Conversation cleared');
}

// LLM integration functions
async function onSendToLLM(isRegen = false) {
    ensureCtx();
    if (!currentCharacter) return;
    
    const editModalId = `stcmCharEditModal-${currentCharacter.avatar}`;
    const editModal = document.getElementById(editModalId);
    const input = editModal?.querySelector('.stcm-gw-ta');
    
    if (!input) return;

    const userMessage = input.value.trim();
    if (!userMessage && !isRegen) {
        toastr.warning('Please enter a message describing how you want to edit the fields.');
        return;
    }

    if (selectedFields.size === 0) {
        toastr.warning('Please select at least one field to edit.');
        return;
    }

    // Get the last user message for regeneration
    let lastUserMsg = userMessage;
    if (isRegen) {
        const lastUser = [...miniTurns].reverse().find(t => t.role === 'user');
        if (!lastUser) {
            toastr.warning('No prior user instruction to regenerate from.');
            return;
        }
        lastUserMsg = lastUser.content;
    }

    if (!isRegen) {
        // Add user message to conversation
        const userTurn = { role: 'user', content: userMessage, ts: Date.now() };
        miniTurns.push(userTurn);
        appendBubble('user', userMessage, { ts: userTurn.ts });
        input.value = '';
    }

    // Show spinner
    const chatLog = editModal?.querySelector('.stcm-gw-log');
    const spinner = document.createElement('div');
    spinner.textContent = isRegen ? 'Regenerating…' : 'Thinking…';
    Object.assign(spinner.style, { 
        fontSize: '12px', 
        opacity: '0.7', 
        margin: '4px 0 0 2px',
        textAlign: 'center',
        padding: '8px'
    });
    chatLog?.appendChild(spinner);

    try {
        const llmResponse = await callLLMForFieldEditing(lastUserMsg);
        
        if (spinner && spinner.parentNode) {
            spinner.remove();
        }

        if (!llmResponse) {
            if (!isRegen) appendBubble('assistant', '(empty response)');
            return;
        }

        // Handle regeneration vs new response
        if (isRegen) {
            const targetAssistantIdx = [...miniTurns].reverse().findIndex(t => t.role === 'assistant');
            if (targetAssistantIdx !== -1) {
                const actualIdx = miniTurns.length - 1 - targetAssistantIdx;
                const targetTs = miniTurns[actualIdx].ts;
                
                // Update the DOM
                const targetNode = chatLog?.querySelector(`.gw-row[data-role="assistant"][data-ts="${targetTs}"]`);
                const contentEl = targetNode?.querySelector('.gw-content');
                if (contentEl) contentEl.textContent = llmResponse;
                
                // Update the turn data
                miniTurns[actualIdx].content = llmResponse;
            }
        } else {
            const assistantTurn = { role: 'assistant', content: llmResponse, ts: Date.now() };
            miniTurns.push(assistantTurn);
            appendBubble('assistant', llmResponse, { ts: assistantTurn.ts });
        }

        saveSession_cfe();

    } catch (error) {
        console.error('[STCM Field Editor] LLM call failed:', error);
        if (spinner && spinner.parentNode) {
            spinner.remove();
        }
        
        const errorMsg = error.message || 'Failed to get LLM response';
        if (!isRegen) {
            appendBubble('assistant', `Error: ${errorMsg}`);
        }
        toastr.error(`LLM Error: ${errorMsg}`);
    }

    saveSession_cfe();
}

async function callLLMForFieldEditing(userInstruction) {
    ensureCtx();
    
    // Get connection manager profile
    const getCM = () => ctx?.extensionSettings?.connectionManager || null;
    const getSelectedProfile = () => {
        const cm = getCM(); 
        if (!cm) return null;
        const id = cm.selectedProfile; 
        if (!id || !Array.isArray(cm.profiles)) return null;
        return cm.profiles.find(p => p.id === id) || null;
    };

    const profile = getSelectedProfile();
    if (!profile) {
        throw new Error('No connection profile selected. Please configure SillyTavern connection settings.');
    }

    const systemPrompt = buildSystemPrompt();
    const temperature = Number(ctx?.extensionSettings?.memory?.temperature) || 0.7;

    // Resolve API behavior (copied from greeting workshop)
    const apiInfo = resolveApiBehavior(profile);
    if (!apiInfo) {
        throw new Error('Could not resolve API configuration from the selected profile.');
    }

    // Determine family
    const family = profile.mode ? String(profile.mode).toLowerCase() : apiInfo.family;
    
    let llmResponse = '';

    // Check if we're using chat completion or text completion
    const isChatCompletion = (family === 'cc' || apiInfo.selected === 'openai');

    if (isChatCompletion) {
        // Chat completion pathway (OpenAI-style) using ChatCompletionService
        const modelResolved = getModelFromContextByApi(profile) || profile.model || null;
        const custom_url = profile['api-url'] || null;
        const proxy = getProxyByName(profile.proxy);
        const reverse_proxy = proxy?.url || null;
        const proxy_password = proxy?.password || null;

        // Get stop fields (similar to greeting workshop)
        const instructGlobal = getGlobalInstructConfig();
        const instructIsOnProfile = profileInstructEnabled(profile);
        const hasInstructName = !!(profile?.instruct && String(profile.instruct).trim().length);
        const instructEnabled = !!(instructGlobal?.enabled) || instructIsOnProfile || hasInstructName;
        const { cfg: instructCfgRaw } = resolveEffectiveInstruct(profile);
        const instructCfgEff = ensureKoboldcppInstruct(instructCfgRaw, apiInfo);
        const stopFields = buildStopFields(apiInfo, profile, instructEnabled, instructCfgEff);

        const requestPayload = {
            stream: false,
            messages: [
                { role: 'system', content: String(systemPrompt) },
                { role: 'user', content: String(userInstruction) }
            ],
            chat_completion_source: apiInfo.source,
            max_tokens: 2048,
            temperature: temperature,
            ...(stopFields),
            ...(custom_url ? { custom_url } : {}),
            ...(reverse_proxy ? { reverse_proxy } : {}),
            ...(proxy_password ? { proxy_password } : {}),
            ...(modelResolved ? { model: modelResolved } : {})
        };

        // Use ChatCompletionService instead of direct fetch
        const ChatCompletionService = window.ChatCompletionService || 
                                     ctx?.ChatCompletionService ||
                                     SillyTavern?.ChatCompletionService;

        if (!ChatCompletionService) {
            throw new Error('ChatCompletionService not available');
        }

        const response = await ChatCompletionService.processRequest(
            requestPayload,
            {
                presetName: profile.preset || undefined
            },
            true,
            null
        );

        llmResponse = String(response?.content || '').trim();

    } else {
        // Text completion pathway using TextCompletionService
        const modelResolved = getModelFromContextByApi(profile) || profile.model || null;
        const api_server = profile['api-url'] || null;
        
        const prompt = `${systemPrompt}\n\nUser Request: ${userInstruction}\n\nResponse:`;

        // Get stop fields and instruct config
        const instructGlobal = getGlobalInstructConfig();
        const instructIsOnProfile = profileInstructEnabled(profile);
        const hasInstructName = !!(profile?.instruct && String(profile.instruct).trim().length);
        const instructEnabled = !!(instructGlobal?.enabled) || instructIsOnProfile || hasInstructName;
        const { cfg: instructCfgRaw, name: instructName } = resolveEffectiveInstruct(profile);
        const instructCfgEff = ensureKoboldcppInstruct(instructCfgRaw, apiInfo);
        const stopFields = buildStopFields(apiInfo, profile, instructEnabled, instructCfgEff);

        const requestPayload = {
            stream: false,
            prompt: prompt,
            max_tokens: 2048,
            temperature: temperature,
            api_type: apiInfo.api_type,
            ...(stopFields),
            ...(api_server ? { api_server } : {}),
            ...(modelResolved ? { model: modelResolved } : {})
        };

        // Use TextCompletionService instead of direct calls
        const TextCompletionService = window.TextCompletionService || 
                                     ctx?.TextCompletionService ||
                                     SillyTavern?.TextCompletionService;

        if (!TextCompletionService) {
            throw new Error('TextCompletionService not available');
        }

        const response = await TextCompletionService.processRequest(
            requestPayload,
            {
                presetName: profile.preset || undefined,
                instructName: instructEnabled ? (instructName || 'effective') : undefined
            },
            true,
            null
        );

        llmResponse = String(response?.content || '').trim();
    }

    return llmResponse;
}

// Helper function to resolve API behavior (copied from greeting workshop)
function resolveApiBehavior(profile) {
    const getApiMapFromCtx = (profile) => {
        ensureCtx();
        if (!profile || !profile.api) return null;
        const cmap = ctx?.CONNECT_API_MAP || window?.CONNECT_API_MAP || {};
        return cmap[profile.api] || null;
    };

    const m = getApiMapFromCtx(profile);
    if (!m) return null;
    const family = (m.selected === 'openai') ? 'cc' : 'tc';
    return {
        family,               // 'cc' or 'tc'
        selected: m.selected, // 'openai' | 'textgenerationwebui' | ...
        api_type: m.type,     // e.g., 'koboldcpp'
        source: m.source,     // e.g., 'openai'
        button: m.button || null,
    };
}

// Helper functions from greeting workshop
function getGlobalInstructConfig() {
    ensureCtx();
    return ctx?.extensionSettings?.instruct || ctx?.instruct || null;
}

function profileInstructEnabled(profile) {
    return String(profile?.['instruct-state']).toLowerCase() === 'true';
}

function getProxyByName(name) {
    ensureCtx();
    const list = ctx?.proxies || window?.proxies || [];
    if (!name || name === 'None') return null;
    return Array.isArray(list) ? list.find(p => p.name === name) : null;
}

function resolveEffectiveInstruct(profile) {
    ensureCtx();
    const globalCfg = getGlobalInstructConfig() || {};
    const instructName = (profile?.instruct || '').trim();
    const presetName = (profile?.preset || '').trim();

    let presetCfg = null;
    const pick = (name) => {
        if (!name) return null;
        try {
            const a = ctx?.extensionSettings?.instruct?.presets;
            if (a && typeof a[name] === 'object') return a[name];
            const b = ctx?.instruct?.presets;
            if (b && typeof b[name] === 'object') return b[name];
            const c = ctx?.presets;
            if (c && typeof c[name]?.instruct === 'object') return c[name].instruct;
            const d = ctx?.presets?.instruct;
            if (d && typeof d[name] === 'object') return d[name];
        } catch { }
        return null;
    };

    presetCfg = pick(instructName) || pick(presetName);
    const eff = Object.assign({}, globalCfg || {}, presetCfg || {});
    const nameChosen = instructName || presetName || undefined;
    return { cfg: eff, name: nameChosen };
}

function ensureKoboldcppInstruct(instructCfg, apiInfo) {
    if (apiInfo?.api_type !== 'koboldcpp') return instructCfg || {};
    const cfg = Object.assign({}, instructCfg || {});
    const hasSeq = (k) => typeof cfg[k] === 'string' && cfg[k].length > 0;
    if (hasSeq('system_sequence') && hasSeq('input_sequence') && hasSeq('output_sequence')) return cfg;
    const fallback = {
        system_sequence: '<|START_OF_TURN_TOKEN|><|SYSTEM_TOKEN|>',
        system_suffix: '<|END_OF_TURN_TOKEN|>',
        input_sequence: '<|START_OF_TURN_TOKEN|><|USER_TOKEN|>',
        input_suffix: '<|END_OF_TURN_TOKEN|>',
        output_sequence: '<|START_OF_TURN_TOKEN|><|CHATBOT_TOKEN|>',
        output_suffix: '<|END_OF_TURN_TOKEN|>',
        stop_sequence: '<|END_OF_TURN_TOKEN|>',
        system_sequence_prefix: '',
        system_sequence_suffix: '',
    };
    return Object.assign({}, fallback, cfg);
}

function getProfileStops(profile) {
    const raw = profile?.['stop-strings']; 
    if (!raw) return [];
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(parsed) ? parsed.filter(s => typeof s === 'string' && s.length) : [];
    } catch { 
        console.warn('[STCM Field Editor] Could not parse profile stop-strings:', raw); 
        return []; 
    }
}

function mergeStops(...lists) {
    const out = [];
    for (const lst of lists) {
        if (!lst) continue;
        const arr = typeof lst === 'string' ? [lst] : lst;
        if (Array.isArray(arr)) out.push(...arr);
    }
    return out;
}

function buildStopFields(apiInfo, profile, instructEnabled, instructCfgEff) {
    const fromProfile = getProfileStops(profile);
    const fromInstruct = (instructEnabled && instructCfgEff)
        ? [instructCfgEff.stop_sequence, instructCfgEff.output_suffix]
        : [];

    const KCPP_DEFAULT_STOPS = [
        '<|END_OF_TURN_TOKEN|>',
        '<|START_OF_TURN_TOKEN|><|USER_TOKEN|>',
        '<|START_OF_TURN_TOKEN|><|CHATBOT_TOKEN|>',
        '<|START_OF_TURN_TOKEN|><|SYSTEM_TOKEN|>',
        '<STOP>',
    ];

    // Merge profile + instruct
    let merged = mergeStops(fromProfile, fromInstruct);

    // If koboldcpp, ensure the full 5-token set is present
    if (apiInfo?.api_type === 'koboldcpp') {
        merged = mergeStops(merged, KCPP_DEFAULT_STOPS);
    }

    // Dedupe and strip empties
    const unique = [];
    for (const s of merged) {
        if (typeof s === 'string' && s.length && !unique.includes(s)) unique.push(s);
    }

    // Return both keys to mirror "normal" payloads
    return unique.length
        ? { stop: unique, stopping_strings: unique }
        : {};
}

function getModelFromContextByApi(profile) {
    ensureCtx();
    if (!profile || !profile.api) return null;

    try {
        // Canonicalize provider name
        const apiRaw = String(profile.api || '').toLowerCase();
        const canonMap = {
            oai: 'openai', openai: 'openai',
            claude: 'claude', anthropic: 'claude',
            google: 'google', vertexai: 'vertexai',
            ai21: 'ai21',
            mistralai: 'mistralai', mistral: 'mistralai',
            cohere: 'cohere',
            perplexity: 'perplexity',
            groq: 'groq',
            nanogpt: 'nanogpt',
            zerooneai: 'zerooneai',
            deepseek: 'deepseek',
            xai: 'xai',
            pollinations: 'pollinations',
            'openrouter-text': 'openai',
            koboldcpp: 'koboldcpp', kcpp: 'koboldcpp',
        };
        const canonProvider = canonMap[apiRaw] || apiRaw;
        const flatKeys = [`${canonProvider}_model`, `${apiRaw}_model`];

        const containers = [
            { name: 'ctx.chatCompletionSettings', obj: ctx?.chatCompletionSettings },
            { name: 'ctx.textCompletionSettings', obj: ctx?.textCompletionSettings },
            { name: 'ctx.extensionSettings.chatCompletionSettings', obj: ctx?.extensionSettings?.chatCompletionSettings },
            { name: 'ctx.extensionSettings.textCompletionSettings', obj: ctx?.extensionSettings?.textCompletionSettings },
            { name: 'ctx.settings.chatCompletionSettings', obj: ctx?.settings?.chatCompletionSettings },
            { name: 'ctx.settings.textCompletionSettings', obj: ctx?.settings?.textCompletionSettings },
            { name: 'ctx', obj: ctx },
            { name: 'window', obj: window },
        ];

        // 1) flat <provider>_model
        for (const key of flatKeys) {
            for (const c of containers) {
                const v = c.obj?.[key];
                if (typeof v === 'string' && v.trim()) {
                    return v.trim();
                }
            }
        }

        // 2) nested {provider: { model }}
        const providerSectionKeys = [canonProvider, apiRaw];
        for (const c of containers) {
            const root = c.obj;
            if (!root || typeof root !== 'object') continue;
            for (const pkey of providerSectionKeys) {
                const section = root[pkey];
                if (section && typeof section === 'object') {
                    const mv = section.model ?? section.currentModel ?? section.selectedModel ?? section.defaultModel;
                    if (typeof mv === 'string' && mv.trim()) {
                        return mv.trim();
                    }
                }
            }
        }

        // 3) limited deep scan
        const seen = new WeakSet();
        const maxDepth = 5;
        function deepFind(obj, depth, path) {
            if (!obj || typeof obj !== 'object' || seen.has(obj) || depth > maxDepth) return null;
            seen.add(obj);

            for (const key of flatKeys) {
                if (typeof obj[key] === 'string' && obj[key].trim()) {
                    return obj[key].trim();
                }
            }
            for (const pkey of providerSectionKeys) {
                const sec = obj[pkey];
                if (sec && typeof sec === 'object') {
                    const mv = sec.model ?? sec.currentModel ?? sec.selectedModel ?? sec.defaultModel;
                    if (typeof mv === 'string' && mv.trim()) {
                        return mv.trim();
                    }
                }
            }
            for (const k of Object.keys(obj)) {
                const child = obj[k];
                if (child && typeof child === 'object') {
                    const found = deepFind(child, depth + 1, path + '.' + k);
                    if (found) return found;
                }
            }
            return null;
        }
        for (const c of containers) {
            const found = deepFind(c.obj, 0, c.name);
            if (found) return found;
        }

        return null;
    } catch (e) {
        console.warn('[STCM Field Editor] getModelFromContextByApi error:', e);
        return null;
    }
}

async function onApplyChanges(responseText) {
    try {
        // Try to extract JSON from the response - handle markdown code blocks
        let jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (!jsonMatch) {
            // Try without code blocks
            jsonMatch = responseText.match(/\{[\s\S]*\}/);
        }
        
        if (!jsonMatch) {
            toastr.error('No valid JSON found in the response. Please ask the LLM to provide the changes in JSON format.');
            return;
        }

        const jsonString = jsonMatch[1] || jsonMatch[0];
        const changes = JSON.parse(jsonString);
        const validChanges = {};
        
        // Filter to only include selected fields and show what we're checking
        for (const [fieldKey, newValue] of Object.entries(changes)) {
            if (selectedFields.has(fieldKey)) {
                validChanges[fieldKey] = newValue;
                console.log(`[STCM Field Editor] Preparing to apply change to "${fieldKey}"`);
            } else {
                console.log(`[STCM Field Editor] Ignoring "${fieldKey}" - not in selected fields`);
            }
        }

        if (Object.keys(validChanges).length === 0) {
            toastr.warning('No valid field changes found in the response.');
            return;
        }

        // Save to server (this will now filter out unchanged fields)
        await saveCharacterChanges(currentCharacter, validChanges);
        
        // Update the field preview display in the field editor
        updateFieldPreviews();
        
        // Update the character edit panel if it's open
        updateCharacterEditPanel();
        
        // Success message will be shown by saveCharacterChanges based on actual changes applied

    } catch (error) {
        console.error('[STCM Field Editor] Apply changes failed:', error);
        toastr.error('Failed to apply changes. Please check the response format.');
    }
}

function updateFieldPreviews() {
    CHARACTER_FIELDS.forEach(field => {
        const preview = document.querySelector(`label[for="field-${field.key}"] .stcm-field-preview`);
        if (preview) {
            const currentValue = getFieldValue(currentCharacter, field.key);
            preview.textContent = currentValue ? 
                (currentValue.length > 50 ? currentValue.substring(0, 50) + '...' : currentValue) : 
                '(empty)';
        }
    });
}

function updateCharacterEditPanel() {
    // Find any open character edit modal for this character
    const modalId = `stcmCharEditModal-${currentCharacter.avatar}`;
    const editModal = document.getElementById(modalId);
    
    if (editModal) {
        // Update the input fields in the character edit panel
        const inputs = editModal.querySelectorAll('.charEditInput');
        inputs.forEach(input => {
            const fieldPath = input.name;
            if (fieldPath) {
                const currentValue = getFieldValue(currentCharacter, fieldPath);
                if (input.value !== currentValue) {
                    input.value = currentValue;
                    // Trigger change event to notify any listeners
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        });
    }
}

async function saveCharacterChanges(character, changes) {
    try {
        ensureCtx();
        
        // Filter out unchanged fields by comparing current vs new values
        const actualChanges = {};
        let hasChanges = false;
        
        for (const [fieldKey, newValue] of Object.entries(changes)) {
            const currentValue = getFieldValue(character, fieldKey);
            
            // Normalize values for comparison
            const normalizedCurrent = normalizeFieldValue(currentValue, fieldKey);
            const normalizedNew = normalizeFieldValue(newValue, fieldKey);
            
            // Only include if values are actually different
            if (normalizedCurrent !== normalizedNew) {
                actualChanges[fieldKey] = newValue;
                hasChanges = true;
                console.log(`[STCM Field Editor] Field "${fieldKey}" changed:`, {
                    from: normalizedCurrent,
                    to: normalizedNew
                });
            } else {
                console.log(`[STCM Field Editor] Field "${fieldKey}" unchanged, skipping`);
            }
        }
        
        // If no actual changes, don't make API call
        if (!hasChanges) {
            toastr.info('No fields were changed - nothing to save');
            return;
        }
        
        console.log(`[STCM Field Editor] Saving ${Object.keys(actualChanges).length} changed fields:`, Object.keys(actualChanges));
        
        // Use FormData instead of JSON - this is the key fix!
        const formData = new FormData();
        
        // Required fields for the edit endpoint
        formData.append('ch_name', character.name || character.data?.name || '');
        formData.append('avatar_url', character.avatar || '');
        
        // Basic character fields - start with current values
        formData.append('description', character.description || character.data?.description || '');
        formData.append('personality', character.personality || character.data?.personality || '');
        formData.append('scenario', character.scenario || character.data?.scenario || '');
        formData.append('first_mes', character.first_mes || character.data?.first_mes || '');
        formData.append('mes_example', character.mes_example || character.data?.mes_example || '');
        formData.append('creatorcomment', character.creatorcomment || character.data?.creator_notes || '');
        formData.append('tags', Array.isArray(character.tags) ? character.tags.join(',') : '');

        // Extended character data fields
        const charInnerData = character.data || {};
        formData.append('creator', charInnerData.creator || '');
        formData.append('character_version', charInnerData.character_version || '');
        formData.append('creator_notes', charInnerData.creator_notes || character.creatorcomment || '');
        formData.append('system_prompt', charInnerData.system_prompt || '');
        formData.append('post_history_instructions', charInnerData.post_history_instructions || '');

        // Extensions data
        const extensions = charInnerData.extensions || {};
        formData.append('chat', character.chat || '');
        formData.append('create_date', character.create_date || '');
        formData.append('last_mes', character.last_mes || '');
        formData.append('talkativeness', String(extensions.talkativeness || character.talkativeness || 0.5));
        formData.append('fav', String(extensions.fav || character.fav || false));
        formData.append('world', extensions.world || '');

        // Depth prompt data
        const depthPrompt = extensions.depth_prompt || {};
        formData.append('depth_prompt_prompt', depthPrompt.prompt || '');
        formData.append('depth_prompt_depth', String(depthPrompt.depth || 4));
        formData.append('depth_prompt_role', depthPrompt.role || 'system');

        // Handle alternate greetings - start with current data
        const currentGreetings = charInnerData.alternate_greetings || character.alternate_greetings || [];
        let greetingsToSave = currentGreetings;

        // Apply ONLY the actual changes to the form data
        for (const [fieldKey, newValue] of Object.entries(actualChanges)) {
            
            if (fieldKey === 'name') {
                formData.set('ch_name', newValue);
            } else if (fieldKey === 'description') {
                formData.set('description', newValue);
            } else if (fieldKey === 'personality') {
                formData.set('personality', newValue);
            } else if (fieldKey === 'scenario') {
                formData.set('scenario', newValue);
            } else if (fieldKey === 'first_mes') {
                formData.set('first_mes', newValue);
            } else if (fieldKey === 'mes_example') {
                formData.set('mes_example', newValue);
            } else if (fieldKey === 'data.creator_notes') {
                formData.set('creator_notes', newValue);
                formData.set('creatorcomment', newValue); // Also update the legacy field
            } else if (fieldKey === 'data.system_prompt') {
                formData.set('system_prompt', newValue);
            } else if (fieldKey === 'data.post_history_instructions') {
                formData.set('post_history_instructions', newValue);
            } else if (fieldKey === 'data.creator') {
                formData.set('creator', newValue);
            } else if (fieldKey === 'data.extensions.depth_prompt.prompt') {
                formData.set('depth_prompt_prompt', newValue);
            } else if (fieldKey === 'alternate_greetings') {
                // Convert the text format to array format
                if (typeof newValue === 'string') {
                    const messages = newValue.split('\n\n---\n\n').map(g => g.trim()).filter(g => g);
                    greetingsToSave = messages;
                } else if (Array.isArray(newValue)) {
                    greetingsToSave = newValue.map(item => 
                        typeof item === 'object' && item.mes ? item.mes : item
                    );
                } else {
                    greetingsToSave = [];
                }
            } else if (fieldKey.startsWith('alternate_greetings[') && fieldKey.includes('.mes')) {
                // Handle individual alternate greeting updates
                const match = fieldKey.match(/alternate_greetings\[(\d+)\]\.mes/);
                if (match) {
                    const index = parseInt(match[1]);
                    
                    // Convert current greetings to string array if needed
                    greetingsToSave = [...greetingsToSave].map(item => 
                        typeof item === 'object' && item.mes ? item.mes : item
                    );
                    
                    // Ensure array is long enough
                    while (greetingsToSave.length <= index) {
                        greetingsToSave.push('');
                    }
                    
                    // Update the specific greeting
                    greetingsToSave[index] = newValue;
                }
            } else if (fieldKey === 'tags') {
                const tagsStr = Array.isArray(newValue) ? newValue.join(',') : String(newValue);
                formData.set('tags', tagsStr);
            }
        }

        // Add alternate greetings to FormData (FormData handles arrays properly)
        if (Array.isArray(greetingsToSave)) {
            for (const greeting of greetingsToSave) {
                if (greeting && typeof greeting === 'string') {
                    formData.append('alternate_greetings', greeting);
                }
            }
        }

        // Get and add the avatar file - CRITICAL for the edit endpoint
        try {
            const avatarUrl = ctx.getThumbnailUrl('avatar', character.avatar);
            const avatarBlob = await fetch(avatarUrl).then(res => res.blob());
            const avatarFile = new File([avatarBlob], 'avatar.png', { type: 'image/png' });
            formData.append('avatar', avatarFile);
        } catch (avatarError) {
            console.warn('[STCM Field Editor] Could not fetch avatar file:', avatarError);
            // Continue without avatar - the endpoint might still work
        }

        // Add the complete character JSON data
        const updatedCharacter = { ...character };
        for (const [fieldKey, newValue] of Object.entries(actualChanges)) {
            setFieldValue(updatedCharacter, fieldKey, newValue);
        }
        formData.append('json_data', JSON.stringify(updatedCharacter));

        // Get headers and remove Content-Type (let browser set it for FormData)
        const headers = ctx.getRequestHeaders();
        delete headers['Content-Type'];

        console.log('[STCM Field Editor] Sending FormData to /edit endpoint');

        const result = await fetch('/api/characters/edit', {
            method: 'POST',
            headers: headers,
            body: formData,
            cache: 'no-cache'
        });

        if (!result.ok) {
            let errorMessage = 'Failed to save character changes.';
            try {
                const errorText = await result.text();
                if (errorText) {
                    errorMessage = `Character not saved. Error: ${errorText}`;
                }
            } catch {
                errorMessage = `Failed to save character changes. Status: ${result.status} ${result.statusText}`;
            }
            throw new Error(errorMessage);
        }

        toastr.success(`Successfully saved ${Object.keys(actualChanges).length} field changes!`);

        // Update the local character object with the actual changes
        for (const [fieldKey, newValue] of Object.entries(actualChanges)) {
            setFieldValue(currentCharacter, fieldKey, newValue);
        }

        // Use SillyTavern's native character refresh methods
        if (typeof ctx?.getCharacters === 'function') {
            await ctx.getCharacters();
        }
        
        // Trigger character list refresh event if available
        if (ctx?.eventSource && ctx?.event_types?.CHARACTER_EDITED) {
            ctx.eventSource.emit(ctx.event_types.CHARACTER_EDITED, character);
        }
        
        // Refresh our extension's character list
        if (typeof renderCharacterList === 'function') {
            renderCharacterList();
        }
        
        // Call our module's save and reload function
        try {
            const { callSaveandReload } = await import("./index.js");
            if (typeof callSaveandReload === 'function') {
                await callSaveandReload();
            }
        } catch (error) {
            console.warn('[STCM Field Editor] Could not call module reload:', error);
        }

    } catch (error) {
        console.error('[STCM Field Editor] Save failed:', error);
        throw error;
    }
}

// Helper function to normalize field values for accurate comparison
function normalizeFieldValue(value, fieldKey) {
    if (value === null || value === undefined) {
        return '';
    }
    
    if (typeof value !== 'string') {
        return String(value);
    }
    
    // Normalize whitespace and line endings
    let normalized = value.trim();
    
    // For alternate greetings, normalize the separator format
    if (fieldKey === 'alternate_greetings') {
        // Normalize different separator formats to consistent format
        normalized = normalized
            .replace(/\n\n---\n\n/g, '\n\n---\n\n')  // Ensure consistent separator
            .replace(/\r\n/g, '\n')                    // Normalize line endings
            .replace(/\r/g, '\n');                     // Handle old Mac line endings
    } else {
        // For other fields, just normalize line endings
        normalized = normalized
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n');
    }
    
    return normalized;
}


// Export the main function
export function openCharacterFieldEditor(character) {
    openFieldEditor(character);
}

export function initCharacterFieldEditor() {
    console.log('[STCM] Character Field Editor initialized');
}