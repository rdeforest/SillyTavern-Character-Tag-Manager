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
    { key: 'data.system_prompt', label: 'Main Prompt', multiline: true, category: 'advanced', readonly: false },
    { key: 'data.post_history_instructions', label: 'Post-History Instructions', multiline: true, category: 'advanced', readonly: false },
    { key: 'data.extensions.depth_prompt.prompt', label: 'Character Note', multiline: false, category: 'advanced', readonly: false },
    { key: 'data.creator', label: 'Created by', multiline: false, category: 'metadata', readonly: false },
    { key: 'data.creator_notes', label: "Creator's Notes", multiline: true, category: 'metadata', readonly: false },
];

// Store workshop state
let currentCharacter = null;
let modal = null;
let overlay = null;
let selectedFields = new Set(); // Fields to edit
let contextFields = new Set();  // Fields to include as context
let miniTurns = [];

// Persist per character so sessions don't collide
const STATE_KEY = () => {
    const id = currentCharacter?.avatar || 'global';
    return `stcm_field_editor_state_${id}`;
};

function saveSession() {
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


function loadSession() {
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

function clearWorkshopState() {
    ensureCtx();
    try {
        localStorage.removeItem(STATE_KEY());
    } catch {}

    miniTurns = [];
    selectedFields = new Set();
    contextFields = new Set();

    if (modal && modal.parentNode) {
        modal.remove();
        modal = null;
    }
    if (overlay && overlay.parentNode) {
        overlay.remove();
        overlay = null;
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
    const keys = fieldKey.split('.');
    let value = char;
    for (const key of keys) {
        value = value?.[key];
    }
    return value || '';
}

// Set field value in character object using dot notation
function setFieldValue(char, fieldKey, newValue) {
    const keys = fieldKey.split('.');
    const lastKey = keys.pop();
    let target = char;
    
    for (const key of keys) {
        if (!target[key]) target[key] = {};
        target = target[key];
    }
    
    target[lastKey] = newValue;
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
        '',
        'RESPONSE FORMAT:',
        'Return ONLY a valid JSON object with the field keys and new values. Use the exact field keys shown in the current data below.',
        '',
        'Example response format:',
        '{',
        '  "description": "New description text...",',
        '  "personality": "Updated personality traits...",',
        '  "scenario": "New scenario setup..."',
        '}',
        '',
        'CRITICAL RULES:',
        '• Return ONLY the JSON object - no explanations, no markdown formatting, no additional text',
        '• Do NOT wrap the JSON in code blocks (```json or ```)',
        '• Include ONLY the fields that are being edited (not context fields)',
        '• Ensure all JSON strings are properly escaped',
        '• If editing dialogue examples, use proper dialogue formatting with quotes and actions',
        '• Maintain appropriate content rating and avoid inappropriate content',
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
    loadSession();

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
    }

    // Initialize UI
    restoreUIFromState();
}

function closeFieldEditor() {
    if (!currentCharacter) return;
    
    const editModalId = `stcmCharEditModal-${currentCharacter.avatar}`;
    const editModal = document.getElementById(editModalId);
    
    if (editModal) {
        const fieldEditorPanel = editModal.querySelector('.stcm-field-editor-panel');
        if (fieldEditorPanel) {
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
        }
    }
    
    // Clear state
    currentCharacter = null;
    selectedFields = new Set();
    miniTurns = [];
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

    // Fields to Edit section
    const editTitle = el('h4', null, 'Fields to Edit');
    editTitle.style.margin = '0 0 8px 0';
    editTitle.style.fontSize = '14px';
    editTitle.style.color = '#fff';

    const editControls = el('div', 'stcm-field-controls');
    editControls.style.marginBottom = '8px';
    editControls.style.display = 'flex';
    editControls.style.gap = '6px';

    const editAllBtn = mkBtn('All', 'info');
    const editNoneBtn = mkBtn('None', 'ghost');
    editAllBtn.style.padding = '3px 6px';
    editAllBtn.style.fontSize = '11px';
    editNoneBtn.style.padding = '3px 6px';
    editNoneBtn.style.fontSize = '11px';

    editAllBtn.addEventListener('click', () => {
        CHARACTER_FIELDS.forEach(field => {
            if (!field.readonly) selectedFields.add(field.key);
        });
        updateSidePanelCheckboxes();
        saveSession();
    });

    editNoneBtn.addEventListener('click', () => {
        selectedFields.clear();
        updateSidePanelCheckboxes();
        saveSession();
    });

    editControls.append(editAllBtn, editNoneBtn);

    const editFieldList = el('div', 'stcm-edit-field-list');
    editFieldList.style.maxHeight = '120px';
    editFieldList.style.overflowY = 'auto';
    editFieldList.style.marginBottom = '16px';

    // Context Fields section
    const contextTitle = el('h4', null, 'Context Fields (reference only)');
    contextTitle.style.margin = '0 0 8px 0';
    contextTitle.style.fontSize = '14px';
    contextTitle.style.color = '#aaa';

    const contextControls = el('div', 'stcm-context-controls');
    contextControls.style.marginBottom = '8px';
    contextControls.style.display = 'flex';
    contextControls.style.gap = '6px';

    const contextAllBtn = mkBtn('All', 'info');
    const contextNoneBtn = mkBtn('None', 'ghost');
    contextAllBtn.style.padding = '3px 6px';
    contextAllBtn.style.fontSize = '11px';
    contextNoneBtn.style.padding = '3px 6px';
    contextNoneBtn.style.fontSize = '11px';

    contextAllBtn.addEventListener('click', () => {
        CHARACTER_FIELDS.forEach(field => {
            if (!field.readonly) contextFields.add(field.key);
        });
        updateSidePanelCheckboxes();
        saveSession();
    });

    contextNoneBtn.addEventListener('click', () => {
        contextFields.clear();
        updateSidePanelCheckboxes();
        saveSession();
    });

    contextControls.append(contextAllBtn, contextNoneBtn);

    const contextFieldList = el('div', 'stcm-context-field-list');
    contextFieldList.style.maxHeight = '120px';
    contextFieldList.style.overflowY = 'auto';

    // Create field checkboxes for both lists
    CHARACTER_FIELDS.forEach(field => {
        if (field.readonly) return;

        // Edit field checkbox
        const editRow = createFieldCheckbox(field, 'edit');
        editFieldList.appendChild(editRow);

        // Context field checkbox  
        const contextRow = createFieldCheckbox(field, 'context');
        contextFieldList.appendChild(contextRow);
    });

    section.append(
        editTitle, 
        editControls, 
        editFieldList,
        contextTitle, 
        contextControls, 
        contextFieldList
    );
    return section;
}

function createFieldCheckbox(field, type) {
    const row = el('div', 'stcm-field-row');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.marginBottom = '4px';
    row.style.gap = '6px';
    row.style.fontSize = '12px';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `field-${type}-${field.key}`;
    checkbox.checked = type === 'edit' ? selectedFields.has(field.key) : contextFields.has(field.key);
    
    checkbox.addEventListener('change', () => {
        const targetSet = type === 'edit' ? selectedFields : contextFields;
        if (checkbox.checked) {
            targetSet.add(field.key);
        } else {
            targetSet.delete(field.key);
        }
        saveSession();
    });

    const label = document.createElement('label');
    label.htmlFor = `field-${type}-${field.key}`;
    label.style.cursor = 'pointer';
    label.style.flex = '1';
    label.textContent = field.label;

    row.append(checkbox, label);
    return row;
}

function createChatSection() {
    const section = el('div', 'stcm-chat-section');
    section.style.display = 'flex';
    section.style.flexDirection = 'column';
    section.style.height = '100%';

    const chatLog = el('div', 'stcm-gw-log');
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

function updateSidePanelCheckboxes() {
    if (!currentCharacter) return;
    
    const editModalId = `stcmCharEditModal-${currentCharacter.avatar}`;
    const editModal = document.getElementById(editModalId);
    const panel = editModal?.querySelector('.stcm-field-editor-panel');
    
    if (!panel) return;

    CHARACTER_FIELDS.forEach(field => {
        // Update edit checkboxes
        const editCheckbox = panel.querySelector(`#field-edit-${field.key}`);
        if (editCheckbox) {
            editCheckbox.checked = selectedFields.has(field.key);
        }
        
        // Update context checkboxes
        const contextCheckbox = panel.querySelector(`#field-context-${field.key}`);
        if (contextCheckbox) {
            contextCheckbox.checked = contextFields.has(field.key);
        }
    });
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
        applyBtn.style.fontSize = '11px';
        applyBtn.style.padding = '3px 6px';
        copyBtn.style.fontSize = '11px';
        copyBtn.style.padding = '3px 6px';

        applyBtn.addEventListener('click', () => onApplyChanges(text));
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(text);
            toastr.success('Copied to clipboard');
        });

        bar.append(applyBtn, copyBtn);
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
                // Replace newlines and format dialogue examples nicely
                displayValue = value
                    .replace(/<START>/g, '\n🎬 START\n')
                    .replace(/{{char}}:/g, '🎭 Character:')
                    .replace(/{{user}}:/g, '👤 User:')
                    .trim();
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
    saveSession();
    
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

        saveSession();

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

    saveSession();
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
        const canonProvider = String(profile.api || '').toLowerCase().trim();
        const TAG = '[STCM Field Editor]';
        
        const containers = [
            { name: 'ctx.online_status', obj: ctx?.online_status || {} },
            { name: 'ctx.api_server_textgenerationwebui', obj: ctx?.api_server_textgenerationwebui || {} },
            { name: 'ctx.koboldai_settings', obj: ctx?.koboldai_settings || {} },
            { name: 'ctx.horde_settings', obj: ctx?.horde_settings || {} },
            { name: 'ctx.mancer_settings', obj: ctx?.mancer_settings || {} },
            { name: 'ctx.aphrodite_settings', obj: ctx?.aphrodite_settings || {} },
            { name: 'ctx.tabby_settings', obj: ctx?.tabby_settings || {} },
            { name: 'ctx.togetherai_settings', obj: ctx?.togetherai_settings || {} },
            { name: 'ctx.infermaticai_settings', obj: ctx?.infermaticai_settings || {} },
            { name: 'ctx.dreamgen_settings', obj: ctx?.dreamgen_settings || {} },
            { name: 'ctx.openrouter_settings', obj: ctx?.openrouter_settings || {} },
            { name: 'ctx.ai21_settings', obj: ctx?.ai21_settings || {} },
            { name: 'ctx.makersuite_settings', obj: ctx?.makersuite_settings || {} },
            { name: 'ctx.mistralai_settings', obj: ctx?.mistralai_settings || {} },
            { name: 'ctx.custom_settings', obj: ctx?.custom_settings || {} },
            { name: 'ctx.cohere_settings', obj: ctx?.cohere_settings || {} },
            { name: 'ctx.perplexity_settings', obj: ctx?.perplexity_settings || {} },
            { name: 'ctx.groq_settings', obj: ctx?.groq_settings || {} },
        ];

        function deepFind(obj, depth, path) {
            if (depth > 10) return null;
            if (!obj || typeof obj !== 'object') return null;
            for (const pkey of ['model', 'model_textgenerationwebui', 'model_koboldai', 'selected_model']) {
                if (obj.hasOwnProperty(pkey)) {
                    const mv = obj[pkey];
                    if (typeof mv === 'string' && mv.trim().length > 0) {
                        const cleaned = mv.trim();
                        console.debug(`${TAG} FOUND ${path}.${pkey}.model =>`, cleaned);
                        return cleaned;
                    }
                }
            }
            for (const k of Object.keys(obj)) {
                const child = obj[k];
                const childPath = `${path}.${k}`;
                if (child && typeof child === 'object') {
                    const found = deepFind(child, depth + 1, childPath);
                    if (found) return found;
                }
            }
            return null;
        }
        for (const c of containers) {
            const found = deepFind(c.obj, 0, c.name);
            if (found) return found;
        }

        console.debug(`${TAG} no model found for provider:`, canonProvider);
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
        const updatedFields = [];

        // Apply changes to character object
        for (const [fieldKey, newValue] of Object.entries(changes)) {
            if (selectedFields.has(fieldKey)) {
                setFieldValue(currentCharacter, fieldKey, newValue);
                updatedFields.push(fieldKey);
            }
        }

        if (updatedFields.length === 0) {
            toastr.warning('No valid field changes found in the response.');
            return;
        }

        // Save to server
        await saveCharacterChanges(currentCharacter, changes);
        
        // Update the field preview display in the field editor
        updateFieldPreviews();
        
        // Update the character edit panel if it's open
        updateCharacterEditPanel();
        
        toastr.success(`Applied changes to ${updatedFields.length} field(s): ${updatedFields.join(', ')}`);

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
        const csrfRes = await fetch('/csrf-token', { credentials: 'include' });
        const { token } = csrfRes.ok ? await csrfRes.json() : { token: null };

        const payload = { avatar: character.avatar };
        
        // Build the update payload using the same structure as the character panel
        for (const [fieldKey, newValue] of Object.entries(changes)) {
            const keys = fieldKey.split('.');
            let ref = payload;
            while (keys.length > 1) {
                const k = keys.shift();
                ref[k] = ref[k] || {};
                ref = ref[k];
            }
            ref[keys[0]] = newValue;
        }

        const result = await fetch('/api/characters/merge-attributes', {
            method: 'POST',
            headers: Object.assign(
                { 'Content-Type': 'application/json' }, 
                token ? { 'X-CSRF-Token': token } : {}
            ),
            credentials: 'include',
            body: JSON.stringify(payload)
        });

        if (!result.ok) {
            let msg = 'Failed to save character changes.';
            try { msg = await result.text(); } catch {}
            throw new Error(msg);
        }

        // Refresh character list if available
        if (typeof renderCharacterList === 'function') {
            renderCharacterList();
        }

    } catch (error) {
        console.error('[STCM Field Editor] Save failed:', error);
        throw error;
    }
}

// Make modal draggable (copied from greeting workshop)
function makeDraggable(panel, handle) {
    let isDragging = false;
    let startX, startY, startLeft, startTop;

    handle.style.cursor = 'move';

    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = panel.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        panel.style.left = `${startLeft + deltaX}px`;
        panel.style.top = `${startTop + deltaY}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

// Export the main function
export function openCharacterFieldEditor(character) {
    openFieldEditor(character);
}

export function initCharacterFieldEditor() {
    console.log('[STCM] Character Field Editor initialized');
}