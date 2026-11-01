# Organizing many conversations in OxeChat

> OxeChat organizes many conversations and the work inside them, and everything stays in place after a restart.

<!-- About this page: Slice S3 · Filled by: FRONTEND · Items: F13, F15, F14, F30, F17, B1.3, B1.4, B19, B20 · partial: written from what is on main on 10/31 (sections and the conversation menu, F13; side chat, F15a). Nested conversations and the coordinator (#287/#290, #219), the session panel (F14, #227), activity (F30, #298) and archiving when the PR closes join when they reach main. -->

Also in: [pt-BR](../pt-BR/03-conversas.md)

## What you can do

- Grouping conversations in sections
- Using a conversation's menu
- A side chat about a conversation
- Conversations an agent started (nested)
- The project coordinator and the project view
- Session panel: context, tools and cost
- Activity: what happened while you were away
- Archiving the conversation when its PR closes

## How to

### Grouping conversations in sections

Sections group a project's conversations under a name. OXESpace keeps them, so they're the same after a restart.

1. In the OxeChat sidebar, open the project's **…** menu and choose **New section…**.
2. Type the **Section name** (up to the limit shown under the field) and click **Create section**.
3. To put a conversation in the section, drag it there, or open the conversation's menu and use **Move to section**.
   The same submenu can create a new section with the conversation already in it.
4. To collapse or expand a section, click its name.
5. The section's **…** menu has **Rename section…**, **Move section up**, **Move section down** and **Delete
   section…**.

Deleting a section deletes no conversation: its conversations go back to **No section**.

### Using a conversation's menu

Right-click a conversation in the list, use its **…** button, or, with the conversation focused, press `Shift+F10` or
the menu key. The menu has:

- **Open to the side**: opens the conversation side by side with the current one;
- **Rename conversation…**;
- **Pin conversation** / **Unpin conversation**: pinned ones stay under **Pinned**, at the top of the list;
- **Move to section**;
- **Mark as read** / **Mark as unread**;
- **Archive conversation**: it leaves the list and waits in **Archived**, where you can restore it (or use
  `/resume`);
- **Delete conversation**: removes it from OXESpace. The provider session and the project files are kept.

Archiving or deleting asks first, and a running turn stops. If the conversation has its own worktree, OXESpace asks
what to do with it first.

### A side chat about a conversation

The side chat answers questions about a conversation without touching it.

1. With the conversation open, press `Ctrl+.` (`Cmd+.` on macOS), or open **More actions** at the top of the
   conversation and choose **Side chat**.
2. A drawer opens beside it with a **Read-only copy** of the conversation. Type in **Ask about this conversation…**
   and click **Ask**.
3. The drawer shows the questions' **Cost so far**.
4. To close it, press `Ctrl+.` again or use the drawer's close button.

### Conversations an agent started (nested)

<!-- TO FILL when #287/#290 land: conversations an agent started show under the parent conversation; the section
follows the parent ("Section follows the parent conversation"). -->

1. …

### The project coordinator and the project view

<!-- TO FILL when #219 lands (coordinator unified with the Project team). -->

1. …

### Session panel: context, tools and cost

<!-- TO FILL when F14 (#227) lands. -->

1. …

### Activity: what happened while you were away

<!-- TO FILL when F30 (#298) lands: the bell, Ctrl+Shift+A, what needs you, what finished and what's new. -->

1. …

### Archiving the conversation when its PR closes

<!-- TO FILL when the item reaches main. -->

1. …

## What OXESpace guarantees

- OXESpace keeps the sections, and they're the same after a restart.
- Deleting a section never deletes a conversation.
- The side chat sends nothing to the main conversation, and the copy is thrown away when you close it.
- Deleting a conversation keeps the provider session and the project files.
<!-- Joins with #219: "The project coordinator never answers a request or an approval." -->

## If something goes wrong

- **"Another section in this project already has this name."** Pick another name.
- **"Use 1 to … characters, without line breaks or control characters."** Shorten the name or remove the line breaks.
- **"This section no longer exists."** It was deleted elsewhere; the list updates.
- **"Could not update the sections."** Try again. If it keeps happening, report it from **Help › Report a problem**.
- **"The side chat could not open. Try again."** Close the drawer and open it again with `Ctrl+.`.
- **"The question did not reach the side chat. Close it and open it again."** The copy stopped: close and reopen the
  side chat. The main conversation isn't affected.

<!-- TO FILL with the slices still to come (#287/#290, #219, #227, #298). -->

## On the phone

Nothing changes on the phone.

## Known limits

- Sections are per project; a conversation is in one section at most.

<!-- Screenshots: `docs/guide/assets/S3/<name>.en.<light|dark>.png`. -->
