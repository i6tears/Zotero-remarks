"use strict";

const PREF_PREFIX = "extensions.zotero-list-remarks.item.";
const MENU_ID = "zotero-list-remarks-edit";
const windows = new Map();
let active = false;
let registeredMenu;

function preferenceFor(item) {
  if (!(item instanceof Zotero.Item) || !item.isRegularItem() || item.isFeedItem || !item.key) {
    return null;
  }
  return PREF_PREFIX + item.libraryID + "." + item.key;
}

function getRemark(pref) {
  return Services.prefs.getStringPref(pref, "");
}

function editRemark(window, item) {
  const pref = preferenceFor(item);
  if (!active || !pref) return;

  const current = getRemark(pref);
  const value = { value: current };
  const confirmed = Services.prompt.prompt(
    window, "编辑列表备注", "输入要在标题列显示的备注。留空并确定可恢复原题。",
    value, null, {}
  );
  if (!confirmed || !active) return;

  const remark = value.value.trim();
  if (remark === current) return;
  if (remark) {
    Services.prefs.setStringPref(pref, remark);
  } else {
    Services.prefs.clearUserPref(pref);
  }

  for (const state of windows.values()) {
    state.view?.tree?.invalidate();
  }
}

function attachWindow(window) {
  if (!active || window.closed || windows.has(window)) return;
  const state = {};
  windows.set(window, state);

  function attach(remaining = 200) {
    if (!active || window.closed || windows.get(window) !== state) return;
    const view = window.ZoteroPane?.itemsView;
    if (!view?.tree || typeof view._renderCell !== "function") {
      if (remaining > 0) window.setTimeout(() => attach(remaining - 1), 50);
      return;
    }

    const original = view._renderCell;
    const ownDescriptor = Object.getOwnPropertyDescriptor(view, "_renderCell");
    function renderCell(index, data, column, isFirstColumn) {
      const cell = original.call(this, index, data, column, isFirstColumn);
      if (!active || column.dataKey !== "title") return cell;

      const pref = preferenceFor(this.getRow(index)?.ref);
      const remark = pref && getRemark(pref);
      const text = remark && cell.querySelector(".cell-text");
      if (!text) return cell;

      const title = text.textContent;
      const label = text.getAttribute("aria-label");
      const suffix = title && label?.startsWith(title) ? label.slice(title.length) : "";
      text.textContent = remark;
      text.setAttribute("aria-label", remark + suffix);
      text.setAttribute("dir", "auto");
      text.setAttribute("title", remark);
      return cell;
    }

    state.view = view;
    state.detach = () => {
      if (view._renderCell === renderCell) {
        if (ownDescriptor) {
          Object.defineProperty(view, "_renderCell", ownDescriptor);
        } else {
          delete view._renderCell;
        }
      }
      if (!window.closed) view.tree?.invalidate();
    };
    view._renderCell = renderCell;
    view.tree.invalidate();
  }

  attach();
}

function startup({ id }) {
  active = true;
  registeredMenu = Zotero.MenuManager.registerMenu({
    menuID: MENU_ID,
    pluginID: id,
    target: "main/library/item",
    menus: [{
      menuType: "menuitem",
      onShowing(_event, context) {
        const item = context.items?.length === 1 ? context.items[0] : null;
        const pref = preferenceFor(item);
        context.setVisible(Boolean(pref));
        if (pref) {
          context.menuElem.setAttribute("label", getRemark(pref) ? "编辑列表备注…" : "添加列表备注…");
        }
      },
      onCommand(event, context) {
        if (context.items?.length !== 1) return;
        try {
          editRemark(event.currentTarget.ownerGlobal, context.items[0]);
        } catch (error) {
          Zotero.logError(error);
          Services.prompt.alert(event.currentTarget.ownerGlobal, "文献列表备注", "保存备注失败，请重试。");
        }
      }
    }]
  });

  for (const window of Zotero.getMainWindows()) attachWindow(window);
  Zotero.uiReadyPromise.then(() => {
    if (!active) return;
    for (const window of Zotero.getMainWindows()) attachWindow(window);
  }).catch(error => Zotero.logError(error));
}

function onMainWindowLoad({ window }) {
  attachWindow(window);
}

function onMainWindowUnload({ window }) {
  windows.delete(window);
}

function shutdown(_data, reason) {
  if (reason === APP_SHUTDOWN) return;
  active = false;
  if (registeredMenu) Zotero.MenuManager.unregisterMenu(registeredMenu);
  for (const state of windows.values()) state.detach?.();
  windows.clear();
}
