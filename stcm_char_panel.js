import { renderCharacterList } from "./stcm_characters.js";
// ============================================================================
// stcm_char_panel.js
// ----------------------------------------------------------------------------

export function createEditSectionForCharacter(char) {
    const section = document.createElement('div');
    section.className = 'charEditSection';

    const readOnly = ['avatar', 'create_date'];

    const labelMap = {
        name: 'Name',
        description: 'Description',
        personality: 'Personality Summary',
        scenario: 'Scenario',
        first_mes: 'First Message',
        mes_example: 'Examples of Dialogue',
        creator: "Created by",
        character_version: "Character Version",
        talkativeness: 'Talkativeness',
        create_date: 'Date Created',
        creatorcomment: "Creator's Notes",
        creator_notes: "Creator's Notes",
        system_prompt: "Main Prompt",
        post_history_instructions: "Post-History Instructions",
        'data.extensions.depth_prompt.prompt': "Character Note",
        'data.extensions.depth_prompt.depth': "Depth",
        'data.extensions.depth_prompt.role': "Role"
    };

    function renderField(label, value, path, multiline = true, readonly = false) {
        const row = document.createElement('div');
        row.className = 'editFieldRow';
        row.style.display = 'flex';
        row.style.alignItems = 'flex-start';
        row.style.gap = '8px';

        const lbl = document.createElement('label');
        lbl.textContent = label;
        lbl.className = 'editLabel';
        lbl.style.minWidth = '120px';
        lbl.style.fontWeight = 'bold';

        let input;
        if (path === 'data.extensions.depth_prompt.role') {
            input = document.createElement('select');
            ['system', 'user', 'assistant'].forEach(opt => {
                const option = document.createElement('option');
                option.value = opt;
                option.textContent = opt;
                if (value === opt) option.selected = true;
                input.appendChild(option);
            });
        } else if (!multiline) {
            input = document.createElement('input');
            input.type = 'text';
            input.value = value;
        } else {
            input = document.createElement('textarea');
            input.rows = 3;
            input.value = value;
        }

        input.name = path;
        input.className = 'charEditInput';
        input.readOnly = readonly;
        input.style.flex = '1';

        // Add AI Field Editor checkboxes (only if not readonly)
        const checkboxContainer = document.createElement('div');
        checkboxContainer.className = 'stcm-field-checkboxes';
        checkboxContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-left: 8px;
            align-items: flex-start;
        `;

        if (!readonly) {
            // Edit checkbox
            const editCheckWrapper = document.createElement('div');
            editCheckWrapper.style.cssText = 'display: flex; align-items: center; gap: 4px; font-size: 11px;';
            
            const editCheck = document.createElement('input');
            editCheck.type = 'checkbox';
            editCheck.id = `stcm-edit-${path.replace(/\./g, '-')}`;
            editCheck.className = 'stcm-edit-checkbox';
            editCheck.dataset.fieldKey = path;
            editCheck.style.margin = '0';
            
            // Add event listener to sync with field editor if open
            editCheck.addEventListener('change', () => {
                // Notify field editor if it's open
                const fieldEditorPanel = document.querySelector('.stcm-field-editor-panel');
                if (fieldEditorPanel) {
                    setTimeout(() => {
                        // Use a small delay to ensure all checkboxes are processed
                        const syncEvent = new CustomEvent('stcm-sync-field-selections');
                        document.dispatchEvent(syncEvent);
                    }, 10);
                }
            });
            
            const editLabel = document.createElement('label');
            editLabel.htmlFor = editCheck.id;
            editLabel.textContent = 'Edit';
            editLabel.style.cssText = 'cursor: pointer; color: #4a9eff; font-weight: normal; user-select: none;';
            
            editCheckWrapper.append(editCheck, editLabel);

            // Context checkbox
            const contextCheckWrapper = document.createElement('div');
            contextCheckWrapper.style.cssText = 'display: flex; align-items: center; gap: 4px; font-size: 11px;';
            
            const contextCheck = document.createElement('input');
            contextCheck.type = 'checkbox';
            contextCheck.id = `stcm-context-${path.replace(/\./g, '-')}`;
            contextCheck.className = 'stcm-context-checkbox';
            contextCheck.dataset.fieldKey = path;
            contextCheck.style.margin = '0';
            
            // Add event listener to sync with field editor if open
            contextCheck.addEventListener('change', () => {
                // Notify field editor if it's open
                const fieldEditorPanel = document.querySelector('.stcm-field-editor-panel');
                if (fieldEditorPanel) {
                    setTimeout(() => {
                        // Use a small delay to ensure all checkboxes are processed
                        const syncEvent = new CustomEvent('stcm-sync-field-selections');
                        document.dispatchEvent(syncEvent);
                    }, 10);
                }
            });
            
            const contextLabel = document.createElement('label');
            contextLabel.htmlFor = contextCheck.id;
            contextLabel.textContent = 'Context';
            contextLabel.style.cssText = 'cursor: pointer; color: #ffaa4a; font-weight: normal; user-select: none;';
            
            contextCheckWrapper.append(contextCheck, contextLabel);

            checkboxContainer.append(editCheckWrapper, contextCheckWrapper);
        }

        row.appendChild(lbl);
        row.appendChild(input);
        if (!readonly) {
            row.appendChild(checkboxContainer);
        }
        return row;
    }

    function makeSection(title, open = false) {
        const wrapper = document.createElement('div');
        wrapper.className = 'collapsibleSection';

        const header = document.createElement('div');
        header.className = 'collapsibleHeader';
        header.textContent = title;

        const content = document.createElement('div');
        content.className = 'collapsibleContent';
        if (open) {
            content.classList.add('open');
            header.classList.add('active');
        }

        header.addEventListener('click', () => {
            content.classList.toggle('open');
            header.classList.toggle('active');
        });

        wrapper.appendChild(header);
        wrapper.appendChild(content);
        return { wrapper, content };
    }

    // === Basics (Open by default)
    const { wrapper: basicsWrap, content: basicsFields } = makeSection('Basics', true);
    section.appendChild(basicsWrap);

    const avatarRow = document.createElement('div');
    avatarRow.style.display = 'flex';
    avatarRow.style.alignItems = 'center';
    avatarRow.style.marginBottom = '6px';

    const img = document.createElement('img');
    img.src = `/characters/${char.avatar}`;
    img.alt = char.name;
    img.title = char.avatar;
    img.style.width = '64px';
    img.style.height = '64px';
    img.style.marginRight = '10px';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '8px';
    avatarRow.appendChild(img);

    avatarRow.appendChild(renderField('Name', char.name || '', 'name', false, readOnly.includes('name')));
    basicsFields.appendChild(avatarRow);

    ['description', 'personality', 'scenario', 'first_mes', 'mes_example'].forEach(k => {
        basicsFields.appendChild(renderField(labelMap[k], char[k] || '', k));
    });

    // === Prompt Overrides
    const { wrapper: promptWrap, content: promptFields } = makeSection('Prompt Overrides');
    section.appendChild(promptWrap);

    const noteRow = document.createElement('div');
    noteRow.style.display = 'flex';
    noteRow.style.gap = '10px';
    noteRow.appendChild(renderField('Character Note', char.data?.extensions?.depth_prompt?.prompt || '', 'data.extensions.depth_prompt.prompt', false));
    noteRow.appendChild(renderField('Depth', char.data?.extensions?.depth_prompt?.depth || '', 'data.extensions.depth_prompt.depth', false));
    noteRow.appendChild(renderField('Role', char.data?.extensions?.depth_prompt?.role || '', 'data.extensions.depth_prompt.role', false));
    promptFields.appendChild(noteRow);

    promptFields.appendChild(renderField('Main Prompt', char.data?.system_prompt || '', 'data.system_prompt'));
    promptFields.appendChild(renderField('Post-History Instructions', char.data?.post_history_instructions || '', 'data.post_history_instructions'));

    // === Alternate Greetings
    const { wrapper: altWrap, content: altFields } = makeSection('Alternate Greetings');
    section.appendChild(altWrap);

    const altState = {
        list: Array.isArray(char.data?.alternate_greetings)
            ? [...char.data.alternate_greetings]
            : (Array.isArray(char.alternate_greetings) ? [...char.alternate_greetings] : [])
    };

    function renderAltGreetings() {
        altFields.innerHTML = '';

        const listWrap = document.createElement('div');
        listWrap.className = 'altGreetingsList';

        if (altState.list.length === 0) {
            const empty = document.createElement('div');
            empty.style.opacity = '.8';
            empty.style.fontSize = '12px';
            empty.textContent = 'No alternate greetings yet.';
            listWrap.appendChild(empty);
        }

        altState.list.forEach((text, idx) => {
            const item = document.createElement('div');
            item.className = 'altGreetingItem';
            item.style.display = 'flex';
            item.style.alignItems = 'flex-start';
            item.style.gap = '8px';
            item.style.marginBottom = '8px';

            // Greeting index label
            const indexLabel = document.createElement('div');
            indexLabel.style.cssText = `
                font-size: 11px;
                color: #aaa;
                min-width: 20px;
                padding-top: 4px;
                font-weight: bold;
            `;
            indexLabel.textContent = `${idx + 1}:`;

            const ta = document.createElement('textarea');
            ta.className = 'altGreetingTextarea';
            ta.rows = 3;
            ta.value = text || '';
            ta.style.flex = '1';
            ta.addEventListener('input', () => { altState.list[idx] = ta.value; });

            // AI Field Editor checkboxes for individual alternate greetings
            const checkboxContainer = document.createElement('div');
            checkboxContainer.className = 'stcm-alt-field-checkboxes';
            checkboxContainer.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 4px;
                align-items: flex-start;
            `;

            // Edit checkbox for full greeting object
            const editCheckWrapper = document.createElement('div');
            editCheckWrapper.style.cssText = 'display: flex; align-items: center; gap: 4px; font-size: 11px;';
            
            const editCheck = document.createElement('input');
            editCheck.type = 'checkbox';
            editCheck.id = `stcm-edit-alternate_greetings-${idx}`;
            editCheck.className = 'stcm-edit-checkbox';
            editCheck.dataset.fieldKey = `alternate_greetings[${idx}]`;
            editCheck.style.margin = '0';
            
            // Add event listener to sync with field editor if open
            editCheck.addEventListener('change', () => {
                const fieldEditorPanel = document.querySelector('.stcm-field-editor-panel');
                if (fieldEditorPanel) {
                    setTimeout(() => {
                        const syncEvent = new CustomEvent('stcm-sync-field-selections');
                        document.dispatchEvent(syncEvent);
                    }, 10);
                }
            });
            
            const editLabel = document.createElement('label');
            editLabel.htmlFor = editCheck.id;
            editLabel.textContent = 'Edit';
            editLabel.style.cssText = 'cursor: pointer; color: #4a9eff; font-weight: normal; user-select: none;';
            
            editCheckWrapper.append(editCheck, editLabel);

            // Edit checkbox for just the message
            const mesEditCheckWrapper = document.createElement('div');
            mesEditCheckWrapper.style.cssText = 'display: flex; align-items: center; gap: 4px; font-size: 11px;';
            
            const mesEditCheck = document.createElement('input');
            mesEditCheck.type = 'checkbox';
            mesEditCheck.id = `stcm-edit-alternate_greetings-${idx}-mes`;
            mesEditCheck.className = 'stcm-edit-checkbox';
            mesEditCheck.dataset.fieldKey = `alternate_greetings[${idx}].mes`;
            mesEditCheck.style.margin = '0';
            
            const mesEditLabel = document.createElement('label');
            mesEditLabel.htmlFor = mesEditCheck.id;
            mesEditLabel.textContent = 'Edit Msg';
            mesEditLabel.style.cssText = 'cursor: pointer; color: #4a9eff; font-weight: normal; user-select: none; font-size: 10px;';
            
            mesEditCheckWrapper.append(mesEditCheck, mesEditLabel);

            // Context checkbox for full greeting object
            const contextCheckWrapper = document.createElement('div');
            contextCheckWrapper.style.cssText = 'display: flex; align-items: center; gap: 4px; font-size: 11px;';
            
            const contextCheck = document.createElement('input');
            contextCheck.type = 'checkbox';
            contextCheck.id = `stcm-context-alternate_greetings-${idx}`;
            contextCheck.className = 'stcm-context-checkbox';
            contextCheck.dataset.fieldKey = `alternate_greetings[${idx}]`;
            contextCheck.style.margin = '0';
            
            const contextLabel = document.createElement('label');
            contextLabel.htmlFor = contextCheck.id;
            contextLabel.textContent = 'Context';
            contextLabel.style.cssText = 'cursor: pointer; color: #ffaa4a; font-weight: normal; user-select: none;';
            
            contextCheckWrapper.append(contextCheck, contextLabel);

            // Context checkbox for just the message
            const mesContextCheckWrapper = document.createElement('div');
            mesContextCheckWrapper.style.cssText = 'display: flex; align-items: center; gap: 4px; font-size: 11px;';
            
            const mesContextCheck = document.createElement('input');
            mesContextCheck.type = 'checkbox';
            mesContextCheck.id = `stcm-context-alternate_greetings-${idx}-mes`;
            mesContextCheck.className = 'stcm-context-checkbox';
            mesContextCheck.dataset.fieldKey = `alternate_greetings[${idx}].mes`;
            mesContextCheck.style.margin = '0';
            
            const mesContextLabel = document.createElement('label');
            mesContextLabel.htmlFor = mesContextCheck.id;
            mesContextLabel.textContent = 'Ctx Msg';
            mesContextLabel.style.cssText = 'cursor: pointer; color: #ffaa4a; font-weight: normal; user-select: none; font-size: 10px;';
            
            mesContextCheckWrapper.append(mesContextCheck, mesContextLabel);

            checkboxContainer.append(editCheckWrapper, mesEditCheckWrapper, contextCheckWrapper, mesContextCheckWrapper);

            const del = document.createElement('button');
            del.className = 'stcm_menu_button small';
            del.textContent = 'Delete';
            del.title = 'Remove this alternate greeting';
            del.addEventListener('click', () => {
                altState.list.splice(idx, 1);
                renderAltGreetings();
            });

            item.appendChild(indexLabel);
            item.appendChild(ta);
            item.appendChild(checkboxContainer);
            item.appendChild(del);
            listWrap.appendChild(item);
        });

        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '8px';
        row.style.marginTop = '8px';

        const addBtn = document.createElement('button');
        addBtn.className = 'stcm_menu_button small';
        addBtn.textContent = 'Add Greeting';
        addBtn.addEventListener('click', () => {
            altState.list.push('');
            renderAltGreetings();
        });

        const saveAltBtn = document.createElement('button');
        saveAltBtn.className = 'stcm_menu_button small';
        saveAltBtn.textContent = 'Save Alternate Greetings';
        saveAltBtn.addEventListener('click', async () => {
            try {
                // Clean and filter empties
                const cleaned = altState.list.map(s => String(s || '').replace(/\r/g, '').trim()).filter(s => s.length);
                const csrfRes = await fetch('/csrf-token', { credentials: 'include' });
                const { token } = csrfRes.ok ? await csrfRes.json() : { token: null };

                const update = { avatar: char.avatar, data: { alternate_greetings: cleaned } };
                const res = await fetch('/api/characters/merge-attributes', {
                    method: 'POST',
                    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'X-CSRF-Token': token } : {}),
                    credentials: 'include',
                    body: JSON.stringify(update)
                });

                if (!res.ok) {
                    let msg = 'Failed to save alternate greetings.';
                    try { msg = await res.text(); } catch {}
                    toastr.error(msg);
                    return;
                }

                // Update local char object
                if (!char.data) char.data = {};
                char.data.alternate_greetings = cleaned;
                toastr.success('Alternate greetings saved.');

                try { renderCharacterList && renderCharacterList(); } catch {}
            } catch (e) {
                console.warn('[STCM] Save alternate greetings failed:', e);
                toastr.error('Failed to save alternate greetings (network/CSRF).');
            }
        });

        row.appendChild(addBtn);
        row.appendChild(saveAltBtn);

        altFields.appendChild(listWrap);
        altFields.appendChild(row);
    }

    renderAltGreetings();

    // === Creator Metadata
    const { wrapper: metaWrap, content: metaFields } = makeSection("Creator's Metadata (Not sent with the AI Prompt)");
    section.appendChild(metaWrap);

    metaFields.appendChild(renderField('Character Version', char.data?.character_version || '', 'data.character_version', false));
    metaFields.appendChild(renderField('Created by', char.data?.creator || '', 'data.creator', false));
    const creatorNotes = (char.data?.creator_notes || '').trim() || (char.creatorcomment || '').trim() || '';
    metaFields.appendChild(renderField("Creator's Notes", creatorNotes, 'unified.creator_notes'));
    
    // Ensure tags is always an array before calling join
    const tagsArray = Array.isArray(char.data?.tags) ? char.data.tags : [];
    metaFields.appendChild(renderField('Tags to Embed (comma-separated)', tagsArray.join(', '), 'data.tags'));

    // === Save Button
    const btnRow = document.createElement('div');
    btnRow.className = 'stcm_char_edit_save_row'
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save Changes';
    saveBtn.className = 'stcm_menu_button stcm_char_edit_save small';



    saveBtn.addEventListener('click', async () => {
        const inputs = section.querySelectorAll('.charEditInput');
        const payload = {};
        inputs.forEach(i => {
            if (!i.readOnly) {
                if (i.name === 'unified.creator_notes') {
                    payload.creatorcomment = i.value;
                    payload.data = payload.data || {};
                    payload.data.creator_notes = i.value;
                } else {
                    const keys = i.name.split('.');
                    let ref = payload;
                    while (keys.length > 1) {
                        const k = keys.shift();
                        ref[k] = ref[k] || {};
                        ref = ref[k];
                    }
                    ref[keys[0]] = i.value;
                }
            }
        });

        try {
            const csrfRes = await fetch('/csrf-token', { credentials: 'include' });
            const { token } = csrfRes.ok ? await csrfRes.json() : { token: null };

            const update = Object.assign({}, payload, { avatar: char.avatar });

            const result = await fetch('/api/characters/merge-attributes', {
                method: 'POST',
                headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'X-CSRF-Token': token } : {}),
                credentials: 'include',
                body: JSON.stringify(update)
            });

            if (result.ok) {
                toastr.success(`Saved updates to ${char.name}`);
                renderCharacterList();
            } else {
                let msg = 'Failed to save updates.';
                try { msg = await result.text(); } catch {}
                toastr.error(msg || 'Failed to save updates.');
            }
        } catch (e) {
            console.warn('[STCM] Save character failed:', e);
            toastr.error('Failed to save updates (network/CSRF).');
        }
    });

    btnRow.appendChild(saveBtn);
    section.appendChild(btnRow);
    return section;
}
