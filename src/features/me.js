export function displayNameFromEmail(email) {
	if (!email) return '';
	const s = String(email);
	const at = s.indexOf('@');
	return at > 0 ? s.slice(0, at) : s;
}

export function renderMe(state, { $$ }) {
	const email = state?.me?.user?.email || '';
	const points = state?.me?.user?.points ?? null;

	if (email) {
		$$('[data-bind="user-email"]').forEach(el => { el.textContent = email; });
		$$('[data-bind="user-name"]').forEach(el => { el.textContent = displayNameFromEmail(email); });
	} else {
		// When logged out, ensure we don't show a previous user's identity.
		$$('[data-bind="user-email"]').forEach(el => { el.textContent = ''; });
		$$('[data-bind="user-name"]').forEach(el => { el.textContent = ''; });
	}
	if (points !== null) {
		$$('[data-bind="loyalty-points"]').forEach(el => { el.textContent = String(points); });
	} else {
		$$('[data-bind="loyalty-points"]').forEach(el => { el.textContent = '—'; });
	}
}


