export function initAuth({
	api,
	state,
	loginForm,
	registerForm,
	sendPointsForm,
	sendToInput,
	logoutBtn,
	authStatus,
	pointsStatus,
	setStatus,
	setAuthed,
	loadMe,
	recents,
	onLogoutNavigate,
}) {
	if (logoutBtn) {
		logoutBtn.addEventListener('click', async () => {
			try {
				await api('/api/logout', { method: 'POST' });
			} finally {
				state.me = null;
				setAuthed(false);
				setStatus(pointsStatus, '');
				setStatus(authStatus, '');
				recents?.renderRecents?.(); // clears datalist based on authed user
				if (sendToInput) sendToInput.value = '';
				if (typeof onLogoutNavigate === 'function') onLogoutNavigate();
			}
		});
	}

	if (loginForm) {
		loginForm.addEventListener('submit', async (e) => {
			e.preventDefault();
			setStatus(authStatus, '');
			const fd = new FormData(loginForm);
			const email = fd.get('email');
			const password = fd.get('password');
			try {
				await api('/api/login', { method: 'POST', body: { email, password } });
				loginForm.reset();
				await loadMe();
			} catch (err) {
				setStatus(authStatus, err?.message || 'Login failed');
			}
		});
	}

	if (registerForm) {
		registerForm.addEventListener('submit', async (e) => {
			e.preventDefault();
			setStatus(authStatus, '');
			const fd = new FormData(registerForm);
			const email = fd.get('email');
			const password = fd.get('password');
			try {
				await api('/api/register', { method: 'POST', body: { email, password } });
				registerForm.reset();
				setStatus(authStatus, 'Registered. You can now log in.');
			} catch (err) {
				setStatus(authStatus, err?.message || 'Registration failed');
			}
		});
	}

	if (sendPointsForm) {
		sendPointsForm.addEventListener('submit', async (e) => {
			e.preventDefault();
			setStatus(pointsStatus, '');
			const fd = new FormData(sendPointsForm);
			const to = String(fd.get('to') || '').trim();
			const pointsRaw = String(fd.get('points') || '').trim();

			// Client-side validation to avoid opaque 400s.
			if (!to) {
				setStatus(pointsStatus, 'Please enter a recipient email.');
				return;
			}
			if (!pointsRaw) {
				setStatus(pointsStatus, 'Please enter an amount.');
				return;
			}
			if (!/^\d+$/.test(pointsRaw)) {
				setStatus(pointsStatus, 'Amount must be a whole number.');
				return;
			}
			const points = Number(pointsRaw);
			if (!Number.isFinite(points) || points <= 0) {
				setStatus(pointsStatus, 'Amount must be at least 1.');
				return;
			}

			try {
				const r = await api('/api/send-points', { method: 'POST', body: { to, points } });
				setStatus(pointsStatus, `Sent ${r.sent} points to ${r.to}. Balance: ${r.balance}`);
				recents?.addRecentRecipient?.(r.to);
				if (sendToInput) sendToInput.value = r.to;
				sendPointsForm.reset();
				await loadMe();
			} catch (err) {
				if (err?.status === 401) {
					setStatus(pointsStatus, 'Session expired. Please log in again.');
					state.me = null;
					setAuthed(false);
				} else {
					// Show the server's error message (e.g. recipient not found / insufficient points).
					setStatus(pointsStatus, err?.message || 'Send failed');
				}
			}
		});
	}
}


