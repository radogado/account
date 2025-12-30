import { $, $$, setStatus } from './lib/dom.js';
import { api } from './lib/api.js';
import { state } from './state.js';

import { renderMe } from './features/me.js';
import { initRecents } from './features/recents.js';
import { initTransactions } from './features/transactions.js';
import { initI18n } from './features/i18n.js';
import { initDetailsAnimation } from './features/details.js';
import { initUiEnhancements } from './features/uiEnhancements.js';
import { initRouter } from './features/router.js';
import { initAuth } from './features/auth.js';

function init() {
	const authSection = $('#auth');
	const pointsSection = $('#points');
	const profileWidget = $('.header__profile');
	const loginForm = $('#login-form');
	const registerForm = $('#register-form');
	const sendPointsForm = $('#send-points-form');
	const sendToInput = sendPointsForm?.querySelector('input[name="to"]') || null;
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

	const setAuthed = (isAuthed) => {
		// Auth state only controls auth/points widgets (which live in dashboard view).
		if (authSection) authSection.hidden = !!isAuthed;
		if (pointsSection) pointsSection.hidden = !isAuthed;
		if (profileWidget) profileWidget.hidden = !isAuthed;
		if (logoutBtn) logoutBtn.hidden = !isAuthed;
	};

	const recents = initRecents({
		state,
		recentRecipientsDatalist,
		sendToInput,
	});

	const transactions = initTransactions({
		api,
		state,
		transactionsBody,
		transactionsEmpty,
		transactionsStatus,
		transactionsTableWrap,
		setStatus,
		onSessionExpired: () => setAuthed(false),
	});

	let router;
	const i18n = initI18n({
		state,
		onChange: () => {
			renderMe(state, { $$ });
			router?.applyRoute?.();
		},
	});

	router = initRouter({
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
	});

	const loadMe = async () => {
		try {
			state.me = await api('/api/me');
			setAuthed(true);
			renderMe(state, { $$ });
			recents.renderRecents();
			setStatus(authStatus, '');
		} catch {
			state.me = null;
			setAuthed(false);
			renderMe(state, { $$ });
		}
	};

	initUiEnhancements();
	i18n.bindLanguageControls();
	i18n.bindThemeControls();
	i18n.loadTranslation(); // async; UI falls back to existing text until loaded
	initDetailsAnimation();

	initAuth({
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
		onLogoutNavigate: () => router.navigate('/dashboard', { replace: true }),
	});

	router.bindNav({ homeLink });
	router.migrateLegacyHash();
	loadMe().then(() => router.applyRoute());
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);


