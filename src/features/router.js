export function initRouter({
	state,
	i18n,
	viewSections,
	navRouteLinks,
	pageTitle,
	transactions,
	transactionsStatus,
	transactionsTableWrap,
	transactionsEmpty,
	setStatus,
}) {
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
			'promotions',
		]);
		if (!route) return 'home';
		return allowed.has(route) ? route : 'dashboard';
	};

	const setView = (route) => {
		if (viewSections?.length) {
			viewSections.forEach(sec => { sec.hidden = sec.dataset.view !== route; });
		}

		// Dynamic H1 per view
		if (pageTitle) {
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
			pageTitle.textContent = i18n?.t ? i18n.t(key, pageTitle.textContent) : pageTitle.textContent;
		}

		// Update active nav item (aria-current on <li>) for accessibility.
		(navRouteLinks || []).forEach(a => {
			const li = a.closest('li');
			if (li && li.hasAttribute('aria-current')) li.removeAttribute('aria-current');
		});
		const active = (navRouteLinks || []).find(a => a.getAttribute('href') === `/${route}`);
		const activeLi = active?.closest('li');
		if (activeLi) activeLi.setAttribute('aria-current', 'page');
	};

	const applyRoute = async () => {
		const route = routeFromLocation();
		setView(route);

		// Route-specific behaviors
		if (route === 'transactions') {
			if (!state.me) {
				setStatus(transactionsStatus, 'Please sign in to view transactions.');
				transactions?.clear?.();
				if (transactionsTableWrap) transactionsTableWrap.hidden = true;
				if (transactionsEmpty) transactionsEmpty.hidden = false;
				return;
			}
			setStatus(transactionsStatus, '');
			if (transactionsTableWrap) transactionsTableWrap.hidden = false;
			await transactions?.loadTransactions?.();
		} else {
			setStatus(transactionsStatus, '');
		}
	};

	const navigate = (to, { replace = false } = {}) => {
		if (!to || typeof to !== 'string') return;
		if (!to.startsWith('/')) return;
		if (replace) history.replaceState(null, '', to);
		else history.pushState(null, '', to);
		applyRoute();
	};

	const migrateLegacyHash = () => {
		if (location.hash && location.hash.startsWith('#/')) {
			const legacy = location.hash.replace(/^#\//, '');
			navigate(`/${legacy}`, { replace: true });
		}
	};

	const bindNav = ({ homeLink } = {}) => {
		window.addEventListener('popstate', () => { applyRoute(); }, { passive: true });
		(navRouteLinks || []).forEach(a => {
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

	return { applyRoute, navigate, migrateLegacyHash, bindNav };
}


