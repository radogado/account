(function() {
	const init = () => {
		// --- Minimal local API client + UI state (progressive enhancement) ---
		const api = async (path, { method = 'GET', body } = {}) => {
			const res = await fetch(path, {
				method,
				credentials: 'same-origin',
				headers: body ? { 'Content-Type': 'application/json' } : undefined,
				body: body ? JSON.stringify(body) : undefined
			});
			const ct = res.headers.get('content-type') || '';
			let data = null;
			if (ct.includes('application/json')) {
				try { data = await res.json(); } catch { data = null; }
			} else {
				try { data = await res.text(); } catch { data = null; }
			}
			if (!res.ok) {
				const msg = (data && data.error) ? data.error : (typeof data === 'string' ? data : 'Request failed');
				const err = new Error(msg);
				err.status = res.status;
				err.data = data;
				throw err;
			}
			return data;
		};

		const $ = (sel) => document.querySelector(sel);
		const $$ = (sel) => Array.from(document.querySelectorAll(sel));

		const authSection = $('#auth');
		const pointsSection = $('#points');
		const profileWidget = $('.header__profile');
		const loginForm = $('#login-form');
		const registerForm = $('#register-form');
		const sendPointsForm = $('#send-points-form');
		const sendToInput = sendPointsForm?.querySelector('input[name="to"]') || null;
		// Optional/legacy: refresh button might not exist; keep null-safe.
		const refreshBtn = $('#refresh-me');
		const logoutBtn = $('.btn--logout');
		const authStatus = $('#auth-status');
		const pointsStatus = $('#points-status');
		const transactionsStatus = $('#transactions-status');
		const transactionsBody = $('#transactions-body');
		const transactionsEmpty = $('#transactions-empty');
		const transactionsTableWrap = document.querySelector('.table--transactions')?.closest('.table-wrap') || null;
		const recentRecipientsDatalist = $('#recent-recipients');
		const pageTitle = document.querySelector('[data-bind="page-title"]');
		const viewSections = $$('main [data-view]');
		const navRouteLinks = $$('aside nav a[href^="/"]');
		const homeLink = document.querySelector('.logo[href="/"]');

		const setStatus = (el, msg) => {
			if (!el) return;
			el.textContent = msg || '';
		};

		const setAuthed = (isAuthed) => {
			// Auth state only controls auth/points widgets (which live in dashboard view).
			if (authSection) authSection.hidden = !!isAuthed;
			if (pointsSection) pointsSection.hidden = !isAuthed;
			if (profileWidget) profileWidget.hidden = !isAuthed;
			if (logoutBtn) logoutBtn.hidden = !isAuthed;
		};

		let me = null;

		const displayNameFromEmail = (email) => {
			if (!email) return '';
			const s = String(email);
			const at = s.indexOf('@');
			return at > 0 ? s.slice(0, at) : s;
		};

		const renderMe = () => {
			const email = me?.user?.email || '';
			const points = me?.user?.points ?? null;

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
		};

		const recentsKey = () => {
			const email = me?.user?.email || '';
			return email ? `recentRecipients:${email}` : null;
		};

		const loadRecents = () => {
			const key = recentsKey();
			if (!key) return [];
			try {
				const raw = localStorage.getItem(key);
				const list = raw ? JSON.parse(raw) : [];
				return Array.isArray(list) ? list.filter(x => typeof x === 'string') : [];
			} catch {
				return [];
			}
		};

		const saveRecents = (list) => {
			const key = recentsKey();
			if (!key) return;
			localStorage.setItem(key, JSON.stringify(list.slice(0, 8)));
		};

		const addRecentRecipient = (email) => {
			const to = String(email || '').trim().toLowerCase();
			if (!to) return;
			const list = loadRecents();
			const next = [to, ...list.filter(x => x !== to)].slice(0, 8);
			saveRecents(next);
			renderRecents();
		};

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

		const formatTxDate = (iso) => {
			if (!iso) return '';
			const d = new Date(iso);
			return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
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
					const tr = document.createElement('tr');
					const direction = tx.direction === 'in' ? 'in' : 'out';
					const sign = direction === 'in' ? '+' : '−';
					const other = direction === 'in' ? tx.from : tx.to;

					const tdDate = document.createElement('td');
					tdDate.textContent = formatTxDate(tx.ts);
					tdDate.className = 'tx__date';

					const tdType = document.createElement('td');
					tdType.textContent = direction === 'in' ? 'In' : 'Out';
					tdType.className = `tx__type tx__type--${direction}`;

					const tdPoints = document.createElement('td');
					tdPoints.textContent = `${sign}${tx.points}`;
					tdPoints.className = `tx__points tx__points--${direction}`;

					const tdOther = document.createElement('td');
					tdOther.textContent = other || '';
					tdOther.className = 'tx__other';

					tr.appendChild(tdDate);
					tr.appendChild(tdType);
					tr.appendChild(tdPoints);
					tr.appendChild(tdOther);
					transactionsBody.appendChild(tr);
				});
			} catch (err) {
				if (err.status === 401) {
					setStatus(transactionsStatus, 'Session expired. Please log in again.');
					me = null;
					setAuthed(false);
					if (transactionsTableWrap) transactionsTableWrap.hidden = true;
					if (transactionsEmpty) transactionsEmpty.hidden = false;
				} else {
					setStatus(transactionsStatus, err.message || 'Failed to load transactions');
				}
			}
		};

		const routeFromLocation = () => {
			// Real paths: /dashboard, /transactions, ...
			const p = String(location.pathname || '/');
			const m = p.match(/^\/([^/?#]+)/);
			const route = m ? m[1] : '';
			const allowed = new Set([
				'home',
				'dashboard',
				'withdraw',
				'prepaid-card',
				'transactions',
				'exchange',
				'statement',
				'settings',
				'faq',
				'contact',
				'promotions'
			]);
			if (!route) return 'home';
			return allowed.has(route) ? route : 'dashboard';
		};

		const navigate = (to, { replace = false } = {}) => {
			if (!to || typeof to !== 'string') return;
			if (!to.startsWith('/')) return;
			if (replace) history.replaceState(null, '', to);
			else history.pushState(null, '', to);
			applyRoute();
		};

		const setView = (route) => {
			if (viewSections.length) {
				viewSections.forEach(sec => {
					sec.hidden = sec.dataset.view !== route;
				});
			}

			// Dynamic H1 per view
			if (pageTitle) {
				const lang = document.documentElement.lang || 'en';
				const dict = translation?.[lang] || {};
				const fallback = translation?.en || {};
				const t = (key, fallbackText) => dict[key] || fallback[key] || fallbackText || '';

				const titleKeyByRoute = {
					home: 'account-overview',
					dashboard: 'dashboard',
					withdraw: 'withdraw',
					'prepaid-card': 'prepaid-card',
					transactions: 'transactions-title',
					exchange: 'exchange',
					statement: 'account-statement',
					settings: 'settings',
					faq: 'faq',
					contact: 'contact-us',
					promotions: 'promotions',
				};
				const key = titleKeyByRoute[route] || 'account-overview';
				pageTitle.textContent = t(key, pageTitle.textContent);
			}

			// Update active nav item (aria-current on <li>) for accessibility.
			navRouteLinks.forEach(a => {
				const li = a.closest('li');
				if (li && li.hasAttribute('aria-current')) li.removeAttribute('aria-current');
			});
			const active = navRouteLinks.find(a => a.getAttribute('href') === `/${route}`);
			const activeLi = active?.closest('li');
			if (activeLi) activeLi.setAttribute('aria-current', 'page');
		};

		const applyRoute = async () => {
			const route = routeFromLocation();
			setView(route);

			// Route-specific behaviors
			if (route === 'transactions') {
				if (!me) {
					setStatus(transactionsStatus, 'Please sign in to view transactions.');
					if (transactionsBody) transactionsBody.innerHTML = '';
					if (transactionsTableWrap) transactionsTableWrap.hidden = true;
					if (transactionsEmpty) transactionsEmpty.hidden = false;
					return;
				}
				setStatus(transactionsStatus, '');
				if (transactionsTableWrap) transactionsTableWrap.hidden = false;
				await loadTransactions();
			} else {
				setStatus(transactionsStatus, '');
			}
		};

		const loadMe = async () => {
			try {
				me = await api('/api/me');
				setAuthed(true);
				renderMe();
				renderRecents();
				setStatus(authStatus, '');
			} catch {
				me = null;
				setAuthed(false);
				renderMe();
			}
		};

		// Buttons ripple effect
		const ripple = e => {
			let el = e.target.closest('li') || e.target.closest('.btn');
			let x = e.offsetX || el.clientWidth / 2;
			let y = e.offsetY || el.clientHeight / 2;
			let max_x = Math.max(x, el.clientWidth - x);
			let max_y = Math.max(y, el.clientHeight - y);
			let radius = Math.sqrt(max_x * max_x + max_y * max_y);
			el.style.transitionProperty = 'none';
			el.style.setProperty('--ripple-x', `${x}px`);
			el.style.setProperty('--ripple-y', `${y}px`);
			el.style.setProperty('--ripple-radius', `0px`);
			window.requestAnimationFrame(() => {
				el.style.transitionProperty = '';
				el.style.setProperty('--ripple-radius', `${radius}px`);
			});
		}
		document.querySelectorAll('.btn, aside nav li').forEach(el => {
			el.addEventListener('pointerdown', ripple);
			el.addEventListener('keydown', ripple);
		});
		// Mobile/Desktop menu switching enhancement
		document.querySelectorAll('.account__trigger').forEach(el => {
			let checked = !!el.checked;
			if (checked) {
				el.removeAttribute('checked');
				el.setAttribute('aria-expanded', true);
			}
			el.outerHTML = el.outerHTML.replace('input', 'button').replace('checkbox', 'button');
		});
		document.querySelectorAll('.account__trigger').forEach(el => {
			// Add aria-expanded toggle event on click
			el.addEventListener('click', e => {
				let el = e.target.closest('button');
				// document.querySelector('.account aside nav').scrollTop = 0;
				el.setAttribute('aria-expanded', el.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
			});
		});
		document.querySelector('#mobile-menu-trigger')?.addEventListener('click', e => {
			let main = document.querySelector('main');
			if (main) {
				if (e.target.getAttribute('aria-expanded') === 'true') {
					main.inert = true;
				} else {
					main.inert = false;
				}
			}
		});
		document.querySelector('.account aside input[type="reset"]')?.addEventListener('click', e => {
			document.querySelector(`button[form="${e.target.getAttribute('form')}"]`)?.click();
			document.querySelector('main')?.removeAttribute('inert');
		});
		let transition_timeout;
		window.addEventListener('resize', e => {
			let toggle = document.querySelector('#mobile-menu-trigger');
			if (toggle && !toggle.clientWidth) { // Switching to desktop while mobile menu is closed
				document.querySelector('main')?.removeAttribute('inert');
				toggle.removeAttribute('aria-expanded');
			}
			let account = document.querySelector('.account');
			account.style.setProperty('--transition-duration', 0);
			getComputedStyle(account);
			clearTimeout(transition_timeout);
			transition_timeout = setTimeout(() => {
				account.style.removeProperty('--transition-duration', 0);
			}, 100);
		}, { passive: true });
		document.querySelector('.account')?.setAttribute('data-ready', true);
		document.querySelector('.account')?.addEventListener('click', e => {
			if (!e.target.closest('details')) {
				document.querySelectorAll('details[open]').forEach(el => el.open = false);
			}
		});
		let translation;
		fetch('translation.json').then(response => response.json()).then(response => { translation = response; });
		// document.querySelectorAll('button[data-translate-to]').forEach(el => {
		// 	el.addEventListener('click', e => {
		// 		let button = e.target.closest('button');
		// 		document.querySelector('.account').style.setProperty('--transition-duration', 0);
		// 		document.querySelectorAll('[data-text]').forEach(el => {
		// 			el.innerText = translation[button.dataset.translateTo][el.dataset.text] || el.innerText;
		// 		});
		// 		document.documentElement.dir = translation[button.dataset.translateTo]._direction || 'ltr';
		// 		document.documentElement.lang = button.dataset.translateTo;
		// 		setTimeout(() => document.querySelector('.account').style.removeProperty('--transition-duration'));
		// 	});
		// });
		document.querySelectorAll('input[type="radio"][name="language"]').forEach(el => {
			el.addEventListener('change', e => {
				let button = e.target;
				document.querySelector('.account').style.setProperty('--transition-duration', 0);
				if (translation && translation[button.dataset.language]) {
					document.querySelectorAll('[data-text]').forEach(el => {
						const key = el.dataset.text;
						const lang = button.dataset.language;
						const dict = translation[lang] || {};
						const fallback = translation.en || {};
						el.innerHTML = dict[key] || fallback[key] || el.innerHTML;
					});
					document.documentElement.dir = translation[button.dataset.language]._direction || 'ltr';
				}
				document.documentElement.lang = button.dataset.language;
				setTimeout(() => document.querySelector('.account').style.removeProperty('--transition-duration'));

				// Language switching can overwrite placeholders; re-render dynamic values.
				renderMe();
				applyRoute();
			});
		});
		document.querySelectorAll('input[type="radio"][name="theme"]').forEach(el => {
			el.addEventListener('change', e => {
				if (e.target.checked) {
					document.querySelector('.account')?.classList.forEach(el => {
						if (el.match(/theme-/)) {
							document.querySelector('.account').classList.replace(el, `theme-${e.target.dataset.theme}`);
						}
					});
				}
			});
		});

		// --- Auth + points flows ---
		if (logoutBtn) {
			logoutBtn.addEventListener('click', async () => {
				try {
					await api('/api/logout', { method: 'POST' });
				} finally {
					me = null;
					setAuthed(false);
					setStatus(pointsStatus, '');
					setStatus(transactionsStatus, '');
					setStatus(authStatus, '');
					if (transactionsBody) transactionsBody.innerHTML = '';
					if (transactionsTableWrap) transactionsTableWrap.hidden = true;
					if (transactionsEmpty) transactionsEmpty.hidden = false;
					if (recentRecipientsDatalist) recentRecipientsDatalist.innerHTML = '';
					if (sendToInput) sendToInput.value = '';
					// Move away from protected views like /transactions
					navigate('/dashboard', { replace: true });
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
					setStatus(authStatus, err.message || 'Login failed');
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
					setStatus(authStatus, err.message || 'Registration failed');
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
					addRecentRecipient(r.to);
					if (sendToInput) sendToInput.value = r.to;
					sendPointsForm.reset();
					await loadMe();
				} catch (err) {
					if (err.status === 401) {
						setStatus(pointsStatus, 'Session expired. Please log in again.');
						me = null;
						setAuthed(false);
					} else {
						// Show the server's error message (e.g. recipient not found / insufficient points).
						setStatus(pointsStatus, err.message || 'Send failed');
						console.error('send-points failed', err);
					}
				}
			});
		}

		if (refreshBtn) {
			refreshBtn.addEventListener('click', async () => {
				setStatus(pointsStatus, '');
				await loadMe();
			});
		}

		// Bootstrap session if already logged in (cookie present).
		// Migrate old hash URLs like "/#/transactions" → "/transactions"
		if (location.hash && location.hash.startsWith('#/')) {
			const legacy = location.hash.replace(/^#\//, '');
			navigate(`/${legacy}`, { replace: true });
		}
		loadMe().then(applyRoute);
		window.addEventListener('popstate', () => { applyRoute(); }, { passive: true });
		// Intercept sidebar navigation clicks to avoid full reload (still works without JS).
		navRouteLinks.forEach(a => {
			a.addEventListener('click', (e) => {
				if (e.defaultPrevented) return;
				if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
				const href = a.getAttribute('href');
				if (!href || !href.startsWith('/')) return;
				e.preventDefault();
				navigate(href);
			});
		});
		if (homeLink) {
			homeLink.addEventListener('click', (e) => {
				if (e.defaultPrevented) return;
				if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
				e.preventDefault();
				navigate('/');
			});
		}
	};
	if (document.readyState !== "loading") {
		init();
	} else {
		document.addEventListener("DOMContentLoaded", init);
	}
})();