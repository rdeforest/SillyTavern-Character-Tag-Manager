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
let selectedFields = new Set();
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
            miniTurns = state.miniTurns || [];
        }
    } catch (e) {
        console.warn('[STCM Field Editor] Load session failed:', e);
        selectedFields = new Set();
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

    const currentData = buildCharacterData();

    return [
        `You are a Character Development Assistant helping to edit character card fields for "${charName}".`,
        '',
        `FIELDS TO EDIT: ${selectedFieldsList}`,
        '',
        'INSTRUCTIONS:',
        '• Read the user\'s request carefully and edit ONLY the requested fields',
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
        '• Include ONLY the fields that are being edited',
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

    if (modal) closeFieldEditor();

    overlay = el('div', 'stcm-gw-overlay');
    modal = el('div', 'stcm-gw-modal field-editor');
    modal.style.width = '90vw';
    modal.style.maxWidth = '1200px';
    modal.style.height = '80vh';

    // Header
    const header = el('div', 'stcm-gw-header', `🎭 Field Editor - ${character.name}`);
    
    const closeBtn = mkBtn('X', 'danger');
    closeBtn.addEventListener('click', closeFieldEditor);
    header.append(closeBtn);

    // Main content area (split layout)
    const mainContent = el('div', 'stcm-field-editor-main');
    mainContent.style.display = 'flex';
    mainContent.style.height = 'calc(100% - 120px)';
    mainContent.style.gap = '16px';

    // Left side: Field selection
    const leftPanel = createFieldSelectionPanel();
    leftPanel.style.width = '300px';
    leftPanel.style.minWidth = '300px';

    // Right side: Chat interface
    const rightPanel = createChatPanel();
    rightPanel.style.flex = '1';

    mainContent.append(leftPanel, rightPanel);

    // Footer
    const footer = el('div', 'stcm-gw-footer');
    const clearBtn = mkBtn('Clear Memory', 'danger');
    clearBtn.addEventListener('click', () => {
        if (confirm('Clear all conversation history? This cannot be undone.')) {
            miniTurns = [];
            saveSession();
            restoreUIFromState();
        }
    });

    footer.append(spacer(), clearBtn);

    // Assemble modal
    modal.append(header, mainContent, footer);
    document.body.append(overlay, modal);

    // Esc handler
    const escHandler = (e) => {
        if (e.key === 'Escape' && modal && modal.style.display !== 'none') {
            e.preventDefault();
            e.stopPropagation();
            closeFieldEditor();
        }
    };
    document.addEventListener('keydown', escHandler, true);
    modal._escHandler = escHandler;

    // Draggable
    makeDraggable(modal, header);

    // Initialize UI
    restoreUIFromState();
}

function closeFieldEditor() {
    if (modal?._escHandler) {
        document.removeEventListener('keydown', modal._escHandler, true);
    }
    if (modal) modal.remove();
    if (overlay) overlay.remove();
    modal = null;
    overlay = null;
}

function createFieldSelectionPanel() {
    const panel = el('div', 'stcm-field-selection-panel');
    panel.style.borderRight = '1px solid #444';
    panel.style.paddingRight = '16px';
    panel.style.overflowY = 'auto';

    const title = el('h3', null, 'Select Fields to Edit');
    title.style.marginTop = '0';
    title.style.marginBottom = '16px';

    const controls = el('div', 'stcm-field-controls');
    controls.style.marginBottom = '16px';
    controls.style.display = 'flex';
    controls.style.gap = '8px';

    const selectAllBtn = mkBtn('Select All', 'info');
    const selectNoneBtn = mkBtn('Select None', 'ghost');

    selectAllBtn.addEventListener('click', () => {
        CHARACTER_FIELDS.forEach(field => {
            if (!field.readonly) selectedFields.add(field.key);
        });
        updateFieldCheckboxes();
        saveSession();
    });

    selectNoneBtn.addEventListener('click', () => {
        selectedFields.clear();
        updateFieldCheckboxes();
        saveSession();
    });

    controls.append(selectAllBtn, selectNoneBtn);

    const fieldList = el('div', 'stcm-field-list');
    
    // Group fields by category
    const categories = ['basics', 'advanced', 'metadata'];
    categories.forEach(category => {
        const categoryFields = CHARACTER_FIELDS.filter(f => f.category === category);
        if (categoryFields.length === 0) return;

        const categoryTitle = el('h4', 'stcm-field-category-title');
        categoryTitle.textContent = category.charAt(0).toUpperCase() + category.slice(1);
        categoryTitle.style.marginTop = '16px';
        categoryTitle.style.marginBottom = '8px';
        categoryTitle.style.color = '#aaa';
        fieldList.appendChild(categoryTitle);

        categoryFields.forEach(field => {
            const fieldRow = el('div', 'stcm-field-row');
            fieldRow.style.display = 'flex';
            fieldRow.style.alignItems = 'flex-start';
            fieldRow.style.marginBottom = '8px';
            fieldRow.style.gap = '8px';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `field-${field.key}`;
            checkbox.disabled = field.readonly;
            checkbox.checked = selectedFields.has(field.key);
            
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    selectedFields.add(field.key);
                } else {
                    selectedFields.delete(field.key);
                }
                saveSession();
            });

            const label = document.createElement('label');
            label.htmlFor = `field-${field.key}`;
            label.style.cursor = field.readonly ? 'default' : 'pointer';
            label.style.flex = '1';
            label.style.fontSize = '14px';
            
            const labelText = el('div', null, field.label);
            const currentValue = getFieldValue(currentCharacter, field.key);
            const preview = el('div', 'stcm-field-preview');
            preview.style.fontSize = '12px';
            preview.style.color = '#888';
            preview.style.marginTop = '2px';
            preview.textContent = currentValue ? 
                (currentValue.length > 50 ? currentValue.substring(0, 50) + '...' : currentValue) : 
                '(empty)';
            
            label.append(labelText, preview);

            fieldRow.append(checkbox, label);
            fieldList.appendChild(fieldRow);
        });
    });

    panel.append(title, controls, fieldList);
    return panel;
}

function updateFieldCheckboxes() {
    CHARACTER_FIELDS.forEach(field => {
        const checkbox = document.getElementById(`field-${field.key}`);
        if (checkbox) {
            checkbox.checked = selectedFields.has(field.key);
        }
    });
}

function createChatPanel() {
    const panel = el('div', 'stcm-chat-panel');
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';

    const chatLog = el('div', 'stcm-gw-log');
    chatLog.style.flex = '1';
    chatLog.style.overflowY = 'auto';
    chatLog.style.marginBottom = '16px';
    chatLog.style.border = '1px solid #444';
    chatLog.style.borderRadius = '8px';
    chatLog.style.padding = '16px';
    chatLog.style.backgroundColor = '#1a1a1a';

    const composer = el('div', 'stcm-gw-composer');
    composer.style.display = 'flex';
    composer.style.flexDirection = 'column';
    composer.style.gap = '8px';

    const input = el('textarea', 'stcm-gw-ta');
    input.style.minHeight = '80px';
    input.style.resize = 'vertical';
    input.placeholder = 'Describe how you want to edit the selected fields...';

    const buttonRow = el('div', 'stcm-button-row');
    buttonRow.style.display = 'flex';
    buttonRow.style.gap = '8px';

    const sendBtn = mkBtn('Send to LLM', 'ok');
    const regenBtn = mkBtn('Regenerate Last', 'info');
    
    sendBtn.addEventListener('click', () => onSendToLLM(false));
    regenBtn.addEventListener('click', () => onSendToLLM(true));

    buttonRow.append(sendBtn, regenBtn);
    composer.append(input, buttonRow);

    // Store references for later use
    panel.chatLog = chatLog;
    panel.input = input;
    panel.sendBtn = sendBtn;
    panel.regenBtn = regenBtn;

    panel.append(chatLog, composer);
    return panel;
}

function restoreUIFromState() {
    if (!modal) return;
    
    const chatLog = modal.querySelector('.stcm-gw-log');
    if (!chatLog) return;

    // Clear the DOM log
    chatLog.innerHTML = '';

    // Add initial message
    appendBubble('assistant', 'Select the fields you want to edit from the left panel, then describe how you want to modify them.', { noActions: true });

    // Restore saved turns
    for (const turn of miniTurns) {
        appendBubble(turn.role, turn.content, { ts: turn.ts });
    }

    chatLog.scrollTop = chatLog.scrollHeight;
}

function appendBubble(role, text, opts = {}) {
    const chatLog = modal?.querySelector('.stcm-gw-log');
    if (!chatLog) return;

    const wrap = el('div', 'gw-row');
    wrap.dataset.role = role;
    wrap.dataset.ts = opts.ts || Date.now();

    const bubble = el('div', `gw-bubble gw-bubble--${role}`);
    const content = el('div', 'gw-content');
    content.textContent = text;

    bubble.appendChild(content);

    // Add action buttons for assistant messages
    if (role === 'assistant' && !opts.noActions) {
        const bar = el('div', 'gw-action-bar');
        bar.style.display = 'flex';
        bar.style.gap = '8px';
        bar.style.marginTop = '8px';

        const applyBtn = mkBtn('Apply Changes', 'warn');
        const copyBtn = mkBtn('Copy', 'info');

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

// LLM integration functions
async function onSendToLLM(isRegen = false) {
    ensureCtx();
    const input = modal?.querySelector('.stcm-gw-ta');
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
    const chatLog = modal?.querySelector('.stcm-gw-log');
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

    // Resolve API behavior
    const apiInfo = resolveApiBehavior(profile);
    if (!apiInfo) {
        throw new Error('Could not resolve API configuration from the selected profile.');
    }

    let llmResponse = '';

    // Check if we're using chat completion or text completion
    const isChatCompletion = (apiInfo.family === 'cc' || apiInfo.selected === 'openai');

    if (isChatCompletion) {
        // Chat completion pathway (OpenAI-style)
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userInstruction }
        ];

        const requestPayload = {
            messages: messages,
            model: profile.model || 'gpt-3.5-turbo',
            temperature: temperature,
            max_tokens: 2048,
            stream: false
        };

        const response = await fetch('/api/openai/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API request failed: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        llmResponse = data.choices?.[0]?.message?.content || '';

    } else {
        // Text completion pathway (TGW/Kobold/etc)
        const prompt = `${systemPrompt}\n\nUser Request: ${userInstruction}\n\nResponse:`;

        const requestPayload = {
            stream: false,
            prompt: prompt,
            max_tokens: 2048,
            temperature: temperature,
            api_type: apiInfo.api_type,
            ...(profile['api-url'] ? { api_server: profile['api-url'] } : {}),
            ...(profile.model ? { model: profile.model } : {})
        };

        // Import TextCompletionService if available
        const TextCompletionService = window.TextCompletionService || 
                                     ctx?.TextCompletionService ||
                                     SillyTavern?.TextCompletionService;

        if (!TextCompletionService) {
            throw new Error('TextCompletionService not available');
        }

        const response = await TextCompletionService.processRequest(
            requestPayload,
            {
                presetName: profile.preset || undefined
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

async function onApplyChanges(responseText) {
    try {
        // Try to extract JSON from the response
        let jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            toastr.error('No valid JSON found in the response. Please ask the LLM to provide the changes in JSON format.');
            return;
        }

        const changes = JSON.parse(jsonMatch[0]);
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
        
        // Update the field preview display
        updateFieldPreviews();
        
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