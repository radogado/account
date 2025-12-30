export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function setStatus(el, msg) {
	if (!el) return;
	el.textContent = msg || '';
}


