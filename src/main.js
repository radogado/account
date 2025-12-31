import { $, $$, setStatus } from './lib/dom.js';
import { api, setCsrfToken } from './lib/api.js';
import { state } from './state.js';

import { renderMe } from './features/me.js';
import { initRecents } from './features/recents.js';
import { initTransactions } from './features/transactions.js';
import { initStatement } from './features/statement.js';
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
	const statementStatus = $('#statement-status');
	const statementBody = $('#statement-body');
	const statementEmpty = $('#statement-empty');
	const statementTableWrap = document.querySelector('.table--statement')?.closest('.table-wrap') || null;
	const statementForm = $('#statement-form');
	const statementFrom = $('#stmt-from');
	const statementTo = $('#stmt-to');
	const statementFormat = $('#stmt-format');
	const statementDownload = $('#statement-download');
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

	let router;
	const i18n = initI18n({
		state,
		onChange: () => {
			renderMe(state, { $$ });
			router?.applyRoute?.();
		},
	});

	const transactions = initTransactions({
		api,
		state,
		t: i18n.t,
		transactionsBody,
		transactionsEmpty,
		transactionsStatus,
		transactionsTableWrap,
		setStatus,
		onSessionExpired: () => setAuthed(false),
	});

	const statement = initStatement({
		api,
		state,
		t: i18n.t,
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
		onSessionExpired: () => setAuthed(false),
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
		statement,
		statementStatus,
		statementTableWrap,
		statementEmpty,
		setStatus,
	});

	const loadMe = async () => {
		try {
			state.me = await api('/api/me');
			setCsrfToken(state.me?.csrfToken || null);
			setAuthed(true);
			renderMe(state, { $$ });
			recents.renderRecents();
			setStatus(authStatus, '');
		} catch {
			state.me = null;
			setCsrfToken(null);
			setAuthed(false);
			renderMe(state, { $$ });
		}
	};

	initUiEnhancements();
	statement.bind();
	i18n.bindLanguageControls();
	i18n.bindThemeControls();
	i18n.loadTranslation() // async; UI falls back to existing text until loaded
		.then(() => {
			// If a language was saved (or a radio is already checked), prefer it.
			let saved = null;
			try { saved = localStorage.getItem('language'); } catch {}
			const preferred =
				saved ||
				document.querySelector('input[type="radio"][name="language"]:checked')?.dataset?.language ||
				document.documentElement.lang ||
				'en';
			return i18n.applyLanguage(preferred);
		})
		.catch(() => {});
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


