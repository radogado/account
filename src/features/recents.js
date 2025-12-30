const LIMIT = 8;

function recentsKey(state) {
	const email = state?.me?.user?.email || '';
	return email ? `recentRecipients:${email}` : null;
}

function loadRecentsByKey(key) {
	if (!key) return [];
	try {
		const raw = localStorage.getItem(key);
		const list = raw ? JSON.parse(raw) : [];
		return Array.isArray(list) ? list.filter(x => typeof x === 'string') : [];
	} catch {
		return [];
	}
}

function saveRecentsByKey(key, list) {
	if (!key) return;
	localStorage.setItem(key, JSON.stringify(list.slice(0, LIMIT)));
}

export function initRecents({ state, recentRecipientsDatalist, sendToInput }) {
	const loadRecents = () => loadRecentsByKey(recentsKey(state));

	const renderRecents = () => {
		if (!recentRecipientsDatalist) return;
		recentRecipientsDatalist.innerHTML = '';
		const list = loadRecents();
		list.forEach(v => {
			const opt = document.createElement('option');
			opt.value = v;
			recentRecipientsDatalist.appendChild(opt);
		});
		// Many browsers only show datalist suggestions after typing.
		// To make "recent" feel visible, prefill the last recipient if empty.
		if (sendToInput && !sendToInput.value && list[0]) {
			sendToInput.value = list[0];
		}
	};

	const addRecentRecipient = (email) => {
		const to = String(email || '').trim().toLowerCase();
		if (!to) return;
		const key = recentsKey(state);
		const list = loadRecentsByKey(key);
		const next = [to, ...list.filter(x => x !== to)].slice(0, LIMIT);
		saveRecentsByKey(key, next);
		renderRecents();
	};

	return { loadRecents, renderRecents, addRecentRecipient };
}


