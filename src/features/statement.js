const formatTxDate = (iso) => {
	if (!iso) return '';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString();
};

const isoStartOfDayZ = (yyyyMmDd) => {
	if (!yyyyMmDd) return null;
	return `${yyyyMmDd}T00:00:00.000Z`;
};

const isoEndOfDayZ = (yyyyMmDd) => {
	if (!yyyyMmDd) return null;
	return `${yyyyMmDd}T23:59:59.999Z`;
};

export function initStatement({
	api,
	state,
	t,
	statementForm,
	statementFrom,
	statementTo,
	statementFormat,
	statementBody,
	statementEmpty,
	statementStatus,
	statementTableWrap,
	statementDownload,
	setStatus,
	onSessionExpired,
}) {
	const tt = (key, fallbackText) => (typeof t === 'function' ? t(key, fallbackText) : fallbackText);

	const clear = () => {
		if (statementBody) statementBody.innerHTML = '';
		if (statementDownload) statementDownload.hidden = true;
	};

	const showSignedOut = (msg) => {
		setStatus(statementStatus, msg || tt('statement-signin', 'Please sign in to view your statement.'));
		clear();
		if (statementTableWrap) statementTableWrap.hidden = true;
		if (statementEmpty) statementEmpty.hidden = false;
	};

	const buildQuery = () => {
		const from = isoStartOfDayZ(statementFrom?.value || '');
		const to = isoEndOfDayZ(statementTo?.value || '');
		const usp = new URLSearchParams();
		usp.set('limit', '1000');
		if (from) usp.set('since', from);
		if (to) usp.set('until', to);
		return usp.toString();
	};

	const updateDownloadLink = () => {
		if (!statementDownload) return;
		const fmt = String(statementFormat?.value || 'pdf').toLowerCase();
		if (fmt !== 'csv') {
			statementDownload.hidden = true;
			statementDownload.href = '#';
			return;
		}
		statementDownload.href = `/api/statement.csv?${buildQuery()}`;
		statementDownload.hidden = false;
	};

	const renderRows = (txs) => {
		if (!statementBody || !statementEmpty) return;
		statementBody.innerHTML = '';
		const list = Array.isArray(txs) ? txs : [];
		if (!list.length) {
			statementEmpty.hidden = false;
			return;
		}
		statementEmpty.hidden = true;
		list.forEach(tx => {
			const row = document.createElement('tr');
			const direction = tx.direction === 'in' ? 'in' : 'out';
			const sign = direction === 'in' ? '+' : '−';
			const other = direction === 'in' ? tx.from : tx.to;

			const tdDate = document.createElement('td');
			tdDate.textContent = formatTxDate(tx.ts);
			tdDate.className = 'tx__date';

			const tdType = document.createElement('td');
			tdType.textContent = direction === 'in' ? tt('tx-in', 'Incoming') : tt('tx-out', 'Outgoing');
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
			statementBody.appendChild(row);
		});
	};

	const loadStatement = async () => {
		if (!statementBody || !statementEmpty) return;

		setStatus(statementStatus, '');
		clear();
		statementEmpty.hidden = true;
		if (statementTableWrap) statementTableWrap.hidden = false;

		updateDownloadLink();

		try {
			const r = await api(`/api/transactions?${buildQuery()}`);
			renderRows(r.transactions);
		} catch (err) {
			if (err?.status === 401) {
				setStatus(statementStatus, tt('session-expired', 'Session expired. Please log in again.'));
				state.me = null;
				if (typeof onSessionExpired === 'function') onSessionExpired();
				if (statementTableWrap) statementTableWrap.hidden = true;
				if (statementEmpty) statementEmpty.hidden = false;
			} else {
				setStatus(statementStatus, err?.message || tt('statement-load-failed', 'Failed to load statement'));
				if (statementEmpty) statementEmpty.hidden = false;
			}
		}
	};

	const bind = () => {
		if (statementForm) {
			statementForm.addEventListener('submit', (e) => {
				e.preventDefault();
				if (!state.me) {
					showSignedOut();
					return;
				}
				void loadStatement();
			});
		}
		if (statementFormat) {
			statementFormat.addEventListener('change', () => updateDownloadLink());
		}
		if (statementFrom) statementFrom.addEventListener('change', () => updateDownloadLink());
		if (statementTo) statementTo.addEventListener('change', () => updateDownloadLink());
	};

	return { bind, loadStatement, showSignedOut, clear, updateDownloadLink };
}


