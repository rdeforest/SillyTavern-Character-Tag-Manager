//stcm_characters.js
import {
    debouncePersist,
    buildTagMap,
    getNotes,
    saveNotes,
    parseSearchGroups,
    parseSearchTerm,
    resetModalScrollPositions,
    makeModalDraggable,
    saveModalPosSize,
    clampModalSize,
    createMinimizableModalControls,
    getNextZIndex
} from './utils.js';

import { tags, tag_map, removeTagFromEntity } from "../../../tags.js";
import { characters, selectCharacterById, deleteCharacter } from "../../../../script.js";
import { groups, getGroupAvatar } from "../../../../scripts/group-chats.js";
import { POPUP_RESULT, POPUP_TYPE, callGenericPopup } from "../../../popup.js";
import { callSaveandReload } from "./index.js";
import { renderTagSection, selectedTagIds } from "./stcm_tags_ui.js"
import * as stcmFolders from './stcm_folders.js';
import { getFolderOptionsTree } from './stcm_folders_ui.js'; // adjust path if needed
import { createEditSectionForCharacter } from './stcm_char_panel.js'
import { openAISuggestFolderForCharacter, openAISuggestTagsForCharacter } from './stcm_ai_suggest_folder_tags.js';
import { openCharacterFieldEditor } from './stcm_char_field_editor.js';



async function renderCharacterList() {
    const wrapper = document.getElementById('characterListWrapper');
    if (!wrapper) return;
    const folders = await stcmFolders.loadFolders(); 

    // Remove all old content
    wrapper.innerHTML = '';
    const container = document.createElement('div');
    container.id = 'characterListContainer';
    container.className = 'stcm_scroll_300';
    wrapper.appendChild(container);

    const tagMapById = buildTagMap(tags);
    const selectedTagIdsArr = Array.from(selectedTagIds);
    const selectedTagsDisplay = document.getElementById('selectedTagsDisplay');
    selectedTagsDisplay.innerHTML = '';

    if (selectedTagIdsArr.length > 0) {
        selectedTagIdsArr.forEach(tagId => {
            const tag = tagMapById.get(tagId);
            if (!tag) return;

            const tagEl = document.createElement('span');
            tagEl.className = 'selectedTagBox';
            tagEl.textContent = tag.name;

            selectedTagsDisplay.appendChild(tagEl);
        });
    }

    const showCheckboxes = stcmCharState.isBulkDeleteCharMode || selectedTagIdsArr.length > 0;

    document.getElementById('assignTagsBar').style.display = showCheckboxes ? 'block' : 'none';

    const searchTerm = document.getElementById('charSearchInput')?.value.toLowerCase() || '';
    const sortMode = document.getElementById('charSortMode')?.value || 'alpha_asc';

    const allEntities = [
        ...characters.map(c => ({ type: 'character', id: c.avatar, name: c.name, avatar: c.avatar })),
        ...groups.map(g => ({ type: 'group', id: g.id, name: g.name, avatar: g.avatar }))
    ];

    allEntities.forEach(entity => {
        entity.tagCount = Array.isArray(tag_map[entity.id]) ? tag_map[entity.id].length : 0;
    });

    const rawInput = document.getElementById('charSearchInput')?.value || '';
    const searchGroups = parseSearchGroups(rawInput);

    const filterEntity = (entity) => {
        const charObj = characters.find(c => c.avatar === entity.id);
        const tagIds = tag_map[entity.id] || [];
        const tagNames = tagIds.map(tagId => (tagMapById.get(tagId)?.name?.toLowerCase() || ""));
        const allFields = charObj ? Object.values(charObj).filter(v => typeof v === 'string').join(' ').toLowerCase() : '';
        const name = entity.name.toLowerCase();

        // Folder name (characters only)
        let folderName = '';
        if (entity.type === 'character') {
            const assignedFolder = stcmFolders.getCharacterAssignedFolder(entity.id, folders);
            if (assignedFolder) {
                folderName = assignedFolder.name?.toLowerCase() || '';
            }
        }

        // If no search (empty), show all
        if (searchGroups.length === 0) return true;

        // OR logic: If any group matches, show this entity
        for (const group of searchGroups) {
            let groupMatches = true;
            for (const termStr of group) {
                const term = parseSearchTerm(termStr);
                if (!term) continue;

                // Ensure case-insensitive comparisons
                const termValue = (term.value || '').toLowerCase();

                let match = false;
                if (term.field === 'a') {
                    match = allFields.includes(termValue);
                } else if (term.field === 't') {
                    match = tagNames.some(tagName => tagName.includes(termValue));
                } else if (term.field === 'f') {
                    // Only match folders for characters (not groups)
                    match = entity.type === 'character' && folderName.includes(termValue);
                } else {
                    match = name.includes(termValue);
                }

                if (term.positive && !match) {
                    groupMatches = false;
                    break;
                }
                if (!term.positive && match) {
                    groupMatches = false;
                    break;
                }
            }
            if (groupMatches) return true;
        }
        return false;
    };

    const filtered = allEntities.filter(filterEntity);

    const notes = getNotes();
    let visible = filtered;

    if (sortMode === 'only_zero') {
        visible = filtered.filter(e => e.tagCount === 0);
    } else if (sortMode === 'with_notes') {
        visible = filtered.filter(e =>
            (notes.charNotes[e.id] || '').trim().length > 0
        );
    } else if (sortMode === 'without_notes') {
        visible = filtered.filter(e =>
            !(notes.charNotes[e.id] || '').trim()
        );
    } else if (sortMode === 'no_folder') {
        visible = filtered.filter(e => {
            // Only apply to characters, not groups!
            if (e.type !== 'character') return false;
            const folder = stcmFolders.getCharacterAssignedFolder(e.id, folders);
            return !folder; // Not assigned to any folder
        });
    } else if (sortMode === 'with_folder') {
        visible = filtered.filter(e => {
            if (e.type !== 'character') return false;
            const folder = stcmFolders.getCharacterAssignedFolder(e.id, folders);
            return !!folder; // Assigned to a folder
        });
    }

    visible.sort((a, b) => {
        switch (sortMode) {
            case 'alpha_asc': return a.name.localeCompare(b.name);
            case 'alpha_desc': return b.name.localeCompare(a.name);
            case 'tag_count_desc': return b.tagCount - a.tagCount;
            case 'tag_count_asc': return a.tagCount - b.tagCount;
            default: return 0;
        }
    });

    container.innerHTML = '';
    if (visible.length === 0) {
        container.innerHTML = `<div>No characters or groups found.</div>`;
        return;
    }

    const list = document.createElement('ul');
    list.className = 'charList';

    visible.forEach(entity => {
        const li = document.createElement('li');
        li.classList.add('charListItemWrapper');
        if (entity.type === 'character') {
            li.setAttribute('data-entity-type', 'character');
            li.setAttribute('data-avatar', entity.avatar);
            li.setAttribute('data-name', entity.name);
        } else if (entity.type === 'group') {
            li.setAttribute('data-entity-type', 'group');
            li.setAttribute('data-group-id', entity.id);
            li.setAttribute('data-name', entity.name);
            if (entity.avatar) li.setAttribute('data-avatar', entity.avatar);
        }

        const metaWrapper = document.createElement('div');
        metaWrapper.className = 'charMeta stcm_flex_row_between';

        // === Left side ===
        const leftSide = document.createElement('div');
        leftSide.className = 'charLeftSide';

        const rightContent = document.createElement('div');
        rightContent.className = 'charMetaRight';

        const nameRow = document.createElement('div');
        nameRow.className = 'charNameRow';

        const label = document.createElement('label');
        label.className = 'customCheckboxWrapper';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'assignCharCheckbox';
        checkbox.value = entity.id;
        checkbox.checked = stcmCharState.selectedCharacterIds.has(entity.id);
        checkbox.style.display = showCheckboxes ? 'inline-block' : 'none';

        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                stcmCharState.selectedCharacterIds.add(entity.id);
            } else {
                stcmCharState. selectedCharacterIds.delete(entity.id);
            }
        });

        const checkmark = document.createElement('span');
        checkmark.className = 'customCheckbox';

        label.appendChild(checkbox);
        label.appendChild(checkmark);
        leftSide.appendChild(label);

        const img = document.createElement('img');
        img.className = 'stcm_avatar_thumb charActivate'; 
        img.alt = entity.name;
        img.src = entity.avatar ? `/characters/${entity.avatar}` : 'img/ai4.png';
        img.onerror = () => img.src = 'img/ai4.png';
        leftSide.appendChild(img);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'charName charActivate';
        nameSpan.textContent = `${entity.name} (${entity.tagCount} tag${entity.tagCount !== 1 ? 's' : ''})`;
        nameRow.appendChild(nameSpan);

        // Notes button
        const currentNote = notes.charNotes[entity.id] || '';

        const noteBtn = document.createElement('button');
        noteBtn.className = 'stcm_menu_button small charNotesToggle';
        noteBtn.textContent = 'Notes';
        noteBtn.title = 'View or edit notes';
        noteBtn.style.marginLeft = '8px';

        nameRow.appendChild(noteBtn);
        
        // --- FOLDER DROPDOWN ---
        let folderDropdown;
        let assignedFolder = null;

        if (entity.type === 'character') {
            assignedFolder = stcmFolders.getCharacterAssignedFolder(entity.id, folders);

            const folderDropdownWrapper = document.createElement('span');
            folderDropdownWrapper.className = 'charFolderDropdownWrapper';

            const folderIcon = document.createElement('i');
            folderIcon.className = 'fa-solid fa-folder-open';
            folderIcon.style.fontSize = '1.5em';

            folderDropdown = document.createElement('select');
            folderDropdown.className = 'charFolderDropdown';
            folderDropdown.style.whiteSpace = 'pre';

            const optNone = document.createElement('option');
            optNone.value = '';
            optNone.textContent = '-- No Folder --';
            folderDropdown.appendChild(optNone);

            const folderOptions = getFolderOptionsTree(folders, [], 'root', 0)
                .filter(opt => opt.id !== 'root');

            folderOptions.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.id;
                option.innerHTML = opt.name;
                if (assignedFolder && opt.id === assignedFolder.id) option.selected = true;
                folderDropdown.appendChild(option);
            });

            folderDropdown.addEventListener('change', async (e) => {
                const newFolderId = e.target.value;
                if (assignedFolder) {
                    await stcmFolders.removeCharacterFromFolder(assignedFolder.id, entity.id);
                }
                if (newFolderId) {
                    await stcmFolders.assignCharactersToFolder(newFolderId, [entity.id]);
                }
                toastr.success('Folder assignment updated.');
                callSaveandReload();
                renderCharacterList();
                renderTagSection && renderTagSection();
            });

            folderDropdownWrapper.appendChild(folderIcon);
            folderDropdownWrapper.appendChild(folderDropdown);

            const removeFolderBtn = document.createElement('span');
            removeFolderBtn.className = 'removeFolderBtn';
            removeFolderBtn.textContent = '✕';
            removeFolderBtn.title = 'Remove from folder (set to No Folder)';
            removeFolderBtn.style.cssText = `
                display: ${assignedFolder ? 'inline-block' : 'none'};
                cursor: pointer;
                color: #b55;
                margin-top: -14px;
                font-size: 1.1em;
                font-weight: bold;
            `;

            removeFolderBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                folderDropdown.value = '';
                folderDropdown.dispatchEvent(new Event('change', {bubbles:true}));
            });

            folderDropdownWrapper.appendChild(removeFolderBtn);

            folderDropdown.addEventListener('change', (e) => {
                removeFolderBtn.style.display = folderDropdown.value ? 'inline-block' : 'none';
            });

            nameRow.appendChild(folderDropdownWrapper);

            const suggestFolderBtn = document.createElement('button');
            suggestFolderBtn.className = 'stcm_menu_button small interactable stcm_ai_suggest_folder_btn';
            suggestFolderBtn.title = 'AI Folder suggestion';
            suggestFolderBtn.innerHTML = '<i class="fa-solid fa-folder-tree"></i> Suggest Folder';
            suggestFolderBtn.addEventListener('click', () => {
                openAISuggestFolderForCharacter({ charId: entity.id });
            });
            nameRow.appendChild(suggestFolderBtn);

            const suggestTagsBtn = document.createElement('button');
            suggestTagsBtn.className = 'stcm_menu_button small interactable stcm_ai_suggest_tags_btn';
            suggestTagsBtn.title = 'AI Tag suggestions';
            suggestTagsBtn.innerHTML = '<i class="fa-solid fa-tags"></i> Suggest Tags';
            suggestTagsBtn.addEventListener('click', () => {
                openAISuggestTagsForCharacter({ charId: entity.id });
            });
            nameRow.appendChild(suggestTagsBtn);
        }

        rightContent.appendChild(nameRow);

        const noteWrapper = document.createElement('div');
        noteWrapper.className = 'charNotesWrapper';
        noteWrapper.style.display = 'none';

        const textarea = document.createElement('textarea');
        textarea.className = 'charNoteTextarea';
        textarea.placeholder = 'Add character notes...';
        textarea.value = currentNote;

        const saveBtn = document.createElement('button');
        saveBtn.className = 'stcm_menu_button stcm_save_note_btn small';
        saveBtn.textContent = 'Save Note';

        saveBtn.addEventListener('click', async () => {
            const updated = getNotes();
            updated.charNotes[entity.id] = textarea.value.trim();
            saveNotes(updated);
            debouncePersist();
            toastr.success(`Saved note for ${entity.name}`);
        });

        noteBtn.addEventListener('click', () => {
            const isOpen = noteWrapper.style.display === 'flex';
            noteWrapper.style.display = isOpen ? 'none' : 'flex';
            noteBtn.textContent = isOpen ? 'Notes' : 'Close Notes';
            noteBtn.style.background = isOpen ? '' : 'rgb(169, 122, 50)';
        });

        noteWrapper.appendChild(textarea);
        noteWrapper.appendChild(saveBtn);
        rightContent.appendChild(noteWrapper);

        const description = (characters.find(c => c.avatar === entity.id)?.description || '').trim();
        const excerpt = description.length > 750 ? description.slice(0, 750).trim() + '…' : description;

        const excerptSpan = document.createElement('span');
        excerptSpan.className = 'charExcerpt';
        excerptSpan.textContent = excerpt;
        excerptSpan.setAttribute('title', description);
        excerptSpan.setAttribute('aria-label', description);

        rightContent.appendChild(excerptSpan);

        const tagListWrapper = document.createElement('div');
        tagListWrapper.className = 'assignedTagsWrapper';

        const tagMapById2 = buildTagMap(tags);
        const assignedTags = tag_map[entity.id] || [];
        assignedTags.forEach(tagId => {
            const tag = tagMapById2.get(tagId);
            if (!tag) return;

            const tagBox = document.createElement('span');
            tagBox.className = 'tagBox';
            tagBox.textContent = tag.name;

            const defaultBg = '#333';
            const defaultFg = '#fff';

            const bgColor = (typeof tag.color === 'string' && tag.color.trim() && tag.color.trim() !== '#') ? tag.color.trim() : defaultBg;
            const fgColor = (typeof tag.color2 === 'string' && tag.color2.trim() && tag.color2.trim() !== '#') ? tag.color2.trim() : defaultFg;

            tagBox.style.backgroundColor = bgColor;
            tagBox.style.color = fgColor;

            const removeBtn = document.createElement('span');
            removeBtn.className = 'removeTagBtn';
            removeBtn.textContent = ' ✕';
            removeBtn.addEventListener('click', () => {
                removeTagFromEntity(tag, entity.id);
                callSaveandReload();
                renderTagSection();
                renderCharacterList();
            });

            tagBox.appendChild(removeBtn);
            tagListWrapper.appendChild(tagBox);
        });
        rightContent.appendChild(tagListWrapper);

        leftSide.appendChild(rightContent);
        metaWrapper.appendChild(leftSide);

        // === Right Controls ===
        const rightControls = document.createElement('div');
        rightControls.className = 'charRowRightFixed';

        const editIcon = document.createElement('i');
        editIcon.className = 'fa-solid fa-pen-to-square interactable stcm_edit_icon';
        editIcon.title = 'Edit Character';

        const deleteIcon = document.createElement('i');
        deleteIcon.className = 'fa-solid fa-trash interactable stcm_delete_icon';
        deleteIcon.title = 'Delete Character';

        deleteIcon.addEventListener('click', async () => {
            const confirmed = await callGenericPopup(
                `Are you sure you want to permanently delete <strong>${entity.name}</strong>?`,
                POPUP_TYPE.CONFIRM,
                'Delete Character'
            );
            if (confirmed !== POPUP_RESULT.AFFIRMATIVE) return;

            try {
                // Use SillyTavern's exported deleteCharacter function
                const charIndex = characters.findIndex(c => c.avatar === entity.avatar);
                if (charIndex !== -1) {
                    await deleteCharacter(entity.avatar, { deleteChats: true });
                    toastr.success(`Character "${entity.name}" permanently deleted.`);
                } else {
                    toastr.error(`Character "${entity.name}" not found.`);
                    return;
                }
            } catch (error) {
                console.error('[STCM] Delete character failed:', error);
                toastr.error(`Failed to delete character "${entity.name}".`);
                return;
            }

            // Refresh our extension's UI
            callSaveandReload();
            renderTagSection();
            renderCharacterList();
        });

        rightControls.appendChild(editIcon);
        rightControls.appendChild(deleteIcon);
        metaWrapper.appendChild(rightControls);
        li.appendChild(metaWrapper);

        if (entity.type === 'character') {
            const char = characters.find(c => c.avatar === entity.id);
            if (char) {
                editIcon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openCharEditModal(char);
                });

                img.addEventListener('click', (e) => {
                    e.stopPropagation(); 
                    openCharEditModal(char);
                });

                nameSpan.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openCharEditModal(char);
                });
            }
        }

        list.appendChild(li);
    });

    container.appendChild(list);

    //wire up Select All, after all checkboxes exist:
    const selectAllBox = document.getElementById('selectAllCharactersCheckbox');
    if (selectAllBox) {
        selectAllBox.onchange = function () {
            const checkboxes = container.querySelectorAll('.assignCharCheckbox');
            const ids = Array.from(checkboxes).map(cb => cb.value);
            if (selectAllBox.checked) {
                ids.forEach(id => stcmCharState.selectedCharacterIds.add(id));
            } else {
                ids.forEach(id => stcmCharState.selectedCharacterIds.delete(id));
            }
            renderCharacterList();
        };

        const syncSelectAllState = () => {
            const checkboxes = container.querySelectorAll('.assignCharCheckbox');
            const checked = Array.from(checkboxes).filter(cb => cb.checked).length;
            selectAllBox.checked = checked === checkboxes.length && checked > 0;
            selectAllBox.indeterminate = checked > 0 && checked < checkboxes.length;
        };
        container.querySelectorAll('.assignCharCheckbox').forEach(cb => {
            cb.addEventListener('change', syncSelectAllState);
        });
        syncSelectAllState();
    }

    // ===== BULK FOLDER ASSIGN BAR (ONE TIME) =====
    const bulkFolderSelect = document.getElementById('bulkFolderSelect');
    if (bulkFolderSelect) {
        bulkFolderSelect.innerHTML = '';

        const optNone = document.createElement('option');
        optNone.value = '';
        optNone.textContent = '-- No Folder --';
        bulkFolderSelect.appendChild(optNone);

        const folderOptions = getFolderOptionsTree(folders, [], 'root', 0)
            .filter(opt => opt.id !== 'root');
        folderOptions.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.id;
            option.innerHTML = opt.name;
            bulkFolderSelect.appendChild(option);
        });

        document.getElementById('bulkAssignFolderBtn').onclick = async function() {
            const selectedFolderId = bulkFolderSelect.value;
            const charIds = Array.from(stcmCharState.selectedCharacterIds);
            if (charIds.length === 0) {
                toastr.warning('No characters selected.');
                return;
            }
            for (const charId of charIds) {
                const currentFolder = stcmFolders.getCharacterAssignedFolder(charId, folders);
                if (currentFolder) {
                    await stcmFolders.removeCharacterFromFolder(currentFolder.id, charId);
                }
            }
            if (selectedFolderId) {
                await stcmFolders.assignCharactersToFolder(selectedFolderId, charIds);
                toastr.success(`Assigned ${charIds.length} character${charIds.length !== 1 ? 's' : ''} to folder.`);
            } else {
                toastr.success(`Removed ${charIds.length} character${charIds.length !== 1 ? 's' : ''} from all folders (moved to root).`);
            }
            stcmCharState.selectedCharacterIds.clear();
            callSaveandReload();
            renderCharacterList();
            renderTagSection && renderTagSection();
        };
    }
}

function openCharEditModal(char) {
    const existingModal = document.getElementById('stcmCharEditModal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'stcmCharEditModal';
    modal.className = 'stcm_modal';

    const content = document.createElement('div');
    content.className = 'stcm_modal_content stcm_edit_char_modal';

    const header = document.createElement('div');
    header.className = 'stcm_modal_header drag-handle';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.gap = '10px';

    // Left side - Title
    const titleWrapper = document.createElement('div');
    titleWrapper.style.display = 'flex';
    titleWrapper.style.alignItems = 'center';
    titleWrapper.style.gap = '10px';
    titleWrapper.style.flex = '1';

    const title = document.createElement('span');
    title.textContent = `Edit: ${char.name}`;
    title.style.fontWeight = 'bold';
    titleWrapper.appendChild(title);

    // Center - Save Changes Button
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save Changes';
    saveBtn.className = 'stcm_menu_button stcm_char_edit_save small';
    saveBtn.title = 'Save all changes to character';
    saveBtn.style.cssText = `
        margin: 0;
        padding: 6px 16px;
        font-weight: 600;
    `;

    // Right side - Controls (AI Editor and Close)
    const controlsWrapper = document.createElement('div');
    controlsWrapper.style.display = 'flex';
    controlsWrapper.style.alignItems = 'center';
    controlsWrapper.style.gap = '8px';

    // AI Field Editor Button
    const aiEditorBtn = document.createElement('button');
    aiEditorBtn.className = 'stcm_menu_button small';
    aiEditorBtn.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border: none;
        color: white;
        font-weight: 600;
    `;
    
    const aiIcon = document.createElement('span');
    aiIcon.textContent = '🤖';
    aiIcon.style.fontSize = '14px';
    
    const aiText = document.createElement('span');
    aiText.textContent = 'AI Field Editor';
    
    aiEditorBtn.appendChild(aiIcon);
    aiEditorBtn.appendChild(aiText);
    aiEditorBtn.title = 'Open AI-powered field editor';

    aiEditorBtn.addEventListener('click', async () => {
        try {
            const { openCharacterFieldEditor } = await import('./stcm_char_field_editor.js');
            openCharacterFieldEditor(char);
        } catch (error) {
            console.error('[STCM] Failed to open AI field editor:', error);
            toastr.error('Failed to open AI field editor');
        }
    });

    const close = document.createElement('span');
    close.className = 'stcm_modal_close';
    close.innerHTML = '&times;';
    close.addEventListener('click', () => modal.remove());

    controlsWrapper.appendChild(aiEditorBtn);
    controlsWrapper.appendChild(close);

    header.appendChild(titleWrapper);
    header.appendChild(saveBtn);
    header.appendChild(controlsWrapper);

    const body = document.createElement('div');
    body.className = 'stcm_modal_body';

    const editSection = createEditSectionForCharacter(char);
    body.appendChild(editSection);

    content.appendChild(header);
    content.appendChild(body);
    modal.appendChild(content);
    document.body.appendChild(modal);

    // Set up save button click handler
    saveBtn.addEventListener('click', async () => {
        const inputs = editSection.querySelectorAll('.charEditInput');
        const changes = {};
        
        inputs.forEach(i => {
            if (!i.readOnly) {
                changes[i.name] = i.value;
            }
        });

        try {
            await stcm_saveCharacter(char, changes, true);
            toastr.success(`Saved updates to ${char.name}`);
            
            // Refresh our extension's character list
            renderCharacterList();
            
            // Call our module's save and reload function
            try {
                const { callSaveandReload } = await import("./index.js");
                if (typeof callSaveandReload === 'function') {
                    await callSaveandReload();
                }
            } catch (error) {
                if (isDevMode()) {
                    console.warn('[STCM] Could not call module reload:', error);
                }
            }
        } catch (e) {
            if (isDevMode()) {
                console.warn('[STCM] Save character failed:', e);
            }
            toastr.error(`Failed to save updates: ${e.message}`);
        }
    });

    makeModalDraggable(modal, header);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

// Add this function to inject the button into the native character panel
// Replace the injectStcmEditButton function:
function injectStcmEditButton() {
    const avatarControls = document.getElementById('avatar_controls');
    if (!avatarControls) return;

    // Check if button already exists
    if (document.getElementById('stcm_quick_edit_button')) return;

    // Create the STCM quick edit button
    const stcmEditBtn = document.createElement('div');
    stcmEditBtn.id = 'stcm_quick_edit_button';
    stcmEditBtn.className = 'menu_button fa-solid fa-pen-to-square interactable';
    stcmEditBtn.title = 'Open in STCM Character Editor';
    stcmEditBtn.setAttribute('data-i18n', '[title]Open in STCM Character Editor');
    stcmEditBtn.setAttribute('tabindex', '0');
    stcmEditBtn.setAttribute('role', 'button');
    stcmEditBtn.style.color = '#4a9eff'; // Distinctive color to differentiate from native buttons

    // Add click handler
    stcmEditBtn.addEventListener('click', () => {
        try {
            // Get the context to find the current character
            const context = SillyTavern.getContext();
            const characterId = context?.characterId; // This is the index, not the avatar

            if (characterId === null || characterId === undefined) {
                toastr.warning('No character is currently selected.');
                return;
            }

            // Parse as integer in case it's a string
            const charIndex = parseInt(characterId);
            
            // Get the character by index from the characters array
            const char = context?.characters?.[charIndex];

            if (!char) {
                toastr.error('Could not find character data.');
                console.error('[STCM] Character not found at index:', charIndex);
                return;
            }

            // Open the STCM character edit modal
            openCharEditModal(char);

        } catch (error) {
            console.error('[STCM] Failed to open character edit modal:', error);
            toastr.error('Failed to open STCM character editor.');
        }
    });

    // Find the buttons block container
    const buttonsBlock = avatarControls.querySelector('.form_create_bottom_buttons_block');
    if (!buttonsBlock) return;

    // Insert the button after the favorite button (or at the beginning if favorite not found)
    const favoriteButton = document.getElementById('favorite_button');
    if (favoriteButton) {
        favoriteButton.after(stcmEditBtn);
    } else {
        buttonsBlock.insertBefore(stcmEditBtn, buttonsBlock.firstChild);
    }
}

// Add this to watch for when the character panel opens/changes
function watchCharacterPanel() {
    // Watch for character changes
    const context = SillyTavern.getContext();
    if (context?.eventSource && context?.event_types?.CHARACTER_EDITED) {
        context.eventSource.on(context.event_types.CHARACTER_EDITED, () => {
            // Re-inject button in case the panel was rebuilt
            setTimeout(() => injectStcmEditButton(), 100);
        });
    }

    // Use MutationObserver to detect when avatar_controls becomes visible
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                const avatarControls = document.getElementById('avatar_controls');
                if (avatarControls && avatarControls.style.display !== 'none') {
                    injectStcmEditButton();
                }
            }
            // Also watch for childList changes in case the panel is rebuilt
            if (mutation.type === 'childList') {
                const avatarControls = document.getElementById('avatar_controls');
                if (avatarControls) {
                    injectStcmEditButton();
                }
            }
        }
    });

    // Start observing the right_nav_panel for changes
    const rightNavPanel = document.getElementById('right-nav-panel');
    if (rightNavPanel) {
        observer.observe(rightNavPanel, {
            attributes: true,
            attributeFilter: ['style'],
            childList: true,
            subtree: true
        });
    }

    // Also try to inject immediately in case panel is already open
    injectStcmEditButton();
}

function toggleCharacterList(container, group) {
    const existingList = container.querySelector('.charList');
    const toggleBtn = container.querySelector('.stcm_view_btn');

    if (existingList) {
        existingList.remove();
        if (toggleBtn) {
            toggleBtn.textContent = 'Characters';
            toggleBtn.classList.remove('active');
        }
        return;
    }

    const list = document.createElement('ul');
    list.className = 'charList';

    group.charIds.forEach(charId => {
        let entity = characters.find(c => c.avatar === charId);
        let isGroup = false;

        if (!entity && typeof groups !== 'undefined') {
            entity = groups.find(g => g.id === charId);
            isGroup = !!entity;
        }

        const name = entity?.name || (isGroup ? `Group ${charId}` : `Character ${charId}`);
        const li = document.createElement('li');

        const metaWrapper = document.createElement('div');
        metaWrapper.className = 'charMeta stcm_flex_row';

        const img = document.createElement('img');
        img.className = 'stcm_avatar_thumb charActivate';
        img.alt = name;

        if (isGroup && entity) {
            try {
                const avatarEl = getGroupAvatar(entity);
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = avatarEl[0]?.outerHTML || '';
                const thumb = tempDiv.querySelector('img');
                img.src = thumb?.src || 'img/ai4.png';
            } catch (e) {
                console.warn(`Error loading avatar for group ${entity?.name || charId}`, e);
                img.src = 'img/ai4.png';
            }
        } else {
            img.src = entity?.avatar ? `/characters/${entity.avatar}` : 'img/ai4.png';
        }

        img.onerror = () => {
            img.onerror = null;
            img.src = 'img/ai4.png';
        };

        const nameSpan = document.createElement('span');
        nameSpan.className = 'charName charActivate';
        nameSpan.textContent = name;

        metaWrapper.appendChild(img);
        metaWrapper.appendChild(nameSpan);

        const unassignBtn = document.createElement('button');
        unassignBtn.className = 'stcm_menu_button stcm_unassign interactable small';
        unassignBtn.textContent = 'Unassign';
        unassignBtn.addEventListener('click', () => {
            const tag = tags.find(t => t.id === group.tag.id);
            removeTagFromEntity(tag, charId);

            // Update in-memory group state
            group.charIds = group.charIds.filter(id => id !== charId);

            // Update DOM
            li.remove();

            // Update character count on the tag accordion
            const countSpan = container.querySelector('.tagGroupHeader .tagCharCount');
            if (countSpan) {
                countSpan.textContent = `(${group.charIds.length})`;
            }

            // 🔄 Save and Refresh both sections
            callSaveandReload();
            renderTagSection();
            renderCharacterList();

        });


        li.appendChild(metaWrapper);
        li.appendChild(unassignBtn);
        list.appendChild(li);
    });

    container.appendChild(list);

    if (toggleBtn) {
        toggleBtn.textContent = 'Close Characters';
        toggleBtn.classList.add('active');
    }
}

// name click listener
document.addEventListener('click', function (e) {
    const target = e.target;
    if (target.classList.contains('charActivate')) {
        const li = target.closest('.charListItemWrapper');
        if (li && li.closest('#characterListContainer')) {
            const entityType = li.getAttribute('data-entity-type');
            if (entityType === 'character') {
                const avatar = li.getAttribute('data-avatar');
                const id = avatar ? characters.findIndex(c => c.avatar === avatar) : -1;
                if (id !== -1 && typeof selectCharacterById === 'function') {
                    // console.log('Switching character by index:', id, 'avatar:', avatar);
                    selectCharacterById(id);
                    if (typeof setActiveGroup === 'function') setActiveGroup(null);
                    if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
                } else {
                    toastr.warning('Unable to activate character: not found.');
                }
            } else if (entityType === 'group') {
                toastr.info('Selecting groups not possible from Tag Manager yet.');
            } else {
                toastr.warning('Unknown entity type.');
            }
        }
    }
});


async function refreshCharacterRowInline(charId) {
    const row = document.querySelector(`.charListItemWrapper[data-entity-type="character"][data-avatar="${charId}"]`);
    if (!row) return;

    const folders = await stcmFolders.loadFolders();
    const assigned = stcmFolders.getCharacterAssignedFolder(charId, folders);

    // folder dropdown + remove '✕'
    const dd = row.querySelector('.charFolderDropdown');
    const x = row.querySelector('.charFolderDropdownWrapper .removeFolderBtn');
    if (dd) {
        dd.value = assigned ? assigned.id : '';
        if (x) x.style.display = dd.value ? 'inline-block' : 'none';
    }

    // tag chips and count in name
    const tagIds = Array.isArray(tag_map?.[charId]) ? tag_map[charId] : [];
    const byId = buildTagMap(tags);
    const wrap = row.querySelector('.assignedTagsWrapper');
    if (wrap) {
        wrap.innerHTML = '';
        tagIds.forEach(tid => {
            const t = byId.get(tid); if (!t) return;
            const chip = document.createElement('span');
            chip.className = 'tagBox';
            chip.textContent = t.name;
            chip.style.backgroundColor = (t.color && t.color !== '#') ? t.color : '#333';
            chip.style.color = (t.color2 && t.color2 !== '#') ? t.color2 : '#fff';
            wrap.appendChild(chip);
        });
    }
    const nameSpan = row.querySelector('.charName');
    if (nameSpan) {
        const currentName = row.getAttribute('data-name') || nameSpan.textContent;
        const base = currentName.replace(/\s*\(\d+\s+tags?\)\s*$/, '');
        const n = tagIds.length;
        nameSpan.textContent = `${base} (${n} tag${n !== 1 ? 's' : ''})`;
    }
}

// wire the targeted refresh
document.addEventListener('stcm:character_meta_changed', (e) => {
    if (e?.detail?.charId) refreshCharacterRowInline(e.detail.charId);
});


export {
    renderCharacterList,
    toggleCharacterList,
    injectStcmEditButton,
    watchCharacterPanel
};
export const stcmCharState = {
    isBulkDeleteCharMode: false,
    selectedCharacterIds: new Set(),
};