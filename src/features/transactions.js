const formatTxDate = (iso) => {
	if (!iso) return '';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
};

export function initTransactions({
	api,
	state,
	t,
	transactionsBody,
	transactionsEmpty,
	transactionsStatus,
	transactionsTableWrap,
	setStatus,
	onSessionExpired,
}) {
	const tt = (key, fallbackText) => (typeof t === 'function' ? t(key, fallbackText) : fallbackText);

	const clear = () => {
		if (transactionsBody) transactionsBody.innerHTML = '';
	};

	const showSignedOut = (msg) => {
		setStatus(transactionsStatus, msg || tt('transactions-signin', 'Please sign in to view transactions.'));
		clear();
		if (transactionsTableWrap) transactionsTableWrap.hidden = true;
		if (transactionsEmpty) transactionsEmpty.hidden = false;
	};

	const loadTransactions = async () => {
		if (!transactionsBody || !transactionsEmpty) return;
		setStatus(transactionsStatus, '');
		transactionsBody.innerHTML = '';
		transactionsEmpty.hidden = true;
		if (transactionsTableWrap) transactionsTableWrap.hidden = false;
		try {
			const r = await api('/api/transactions');
			const list = Array.isArray(r.transactions) ? r.transactions : [];
			if (!list.length) {
				transactionsEmpty.hidden = false;
				return;
			}
			list.forEach(tx => {
				const row = document.createElement('tr');
				const direction = tx.direction === 'in' ? 'in' : 'out';
				const sign = direction === 'in' ? '+' : '−';
				const other = direction === 'in' ? tx.from : tx.to;

				const tdDate = document.createElement('td');
				tdDate.textContent = formatTxDate(tx.ts);
				tdDate.className = 'tx__date';

				const tdType = document.createElement('td');
				tdType.textContent = direction === 'in'
					? tt('tx-in', 'In')
					: tt('tx-out', 'Out');
				tdType.className = `tx__type tx__type--${direction}`;

				const tdPoints = document.createElement('td');
				tdPoints.textContent = `${sign}${tx.points}`;
				tdPoints.className = `tx__points tx__points--${direction}`;

				const tdOther = document.createElement('td');
				tdOther.textContent = other || '';
				tdOther.className = 'tx__other';

				row.appendChild(tdDate);
				row.appendChild(tdType);
				row.appendChild(tdPoints);
				row.appendChild(tdOther);
				transactionsBody.appendChild(row);
			});
		} catch (err) {
			if (err?.status === 401) {
				setStatus(transactionsStatus, tt('session-expired', 'Session expired. Please log in again.'));
				state.me = null;
				if (typeof onSessionExpired === 'function') onSessionExpired();
				if (transactionsTableWrap) transactionsTableWrap.hidden = true;
				if (transactionsEmpty) transactionsEmpty.hidden = false;
			} else {
				setStatus(transactionsStatus, err?.message || tt('transactions-load-failed', 'Failed to load transactions'));
			}
		}
	};

	return { loadTransactions, showSignedOut, clear };
}


