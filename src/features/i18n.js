export function initI18n({ state, onChange } = {}) {
	const accountEl = document.querySelector('.account');
	const STORAGE_KEY = 'language';

	const t = (key, fallbackText = '') => {
		const lang = document.documentElement.lang || 'en';
		const dict = state?.translation?.[lang] || {};
		const fallback = state?.translation?.en || {};
		return dict[key] || fallback[key] || fallbackText || '';
	};

	const getPreferredLanguage = () => {
		try {
			return (
				localStorage.getItem(STORAGE_KEY) ||
				document.querySelector('input[type="radio"][name="language"]:checked')?.dataset?.language ||
				document.documentElement.lang ||
				'en'
			);
		} catch {
			return document.documentElement.lang || 'en';
		}
	};

	const loadLang = async (lang) => {
		const res = await fetch(`/i18n/${encodeURIComponent(lang)}.json`, { cache: 'no-cache' });
		if (!res.ok) return null;
		return res.json();
	};

	const ensureLang = async (lang) => {
		if (!lang) return null;
		if (!state.translation || typeof state.translation !== 'object') state.translation = {};
		if (state.translation[lang]) return state.translation[lang];
		const dict = await loadLang(lang);
		if (dict && typeof dict === 'object') state.translation[lang] = dict;
		return state.translation[lang] || null;
	};

	const applyLanguage = async (lang) => {
		if (!lang) return;
		accountEl?.style.setProperty('--transition-duration', 0);

		try { localStorage.setItem(STORAGE_KEY, lang); } catch {}

		try {
			// Always keep EN around as a fallback (missing keys, partial langs).
			await ensureLang('en');
			await ensureLang(lang);
		} catch {
			// fall through: we’ll at least set lang/dir and keep existing text
		}

		const dict = state?.translation?.[lang] || {};
		const fallback = state?.translation?.en || {};

		document.querySelectorAll('[data-text]').forEach(el => {
			const key = el.dataset.text;
			el.innerHTML = dict[key] || fallback[key] || el.innerHTML;
		});
		document.documentElement.dir = dict._direction || 'ltr';

		document.documentElement.lang = lang;
		setTimeout(() => accountEl?.style.removeProperty('--transition-duration'));

		// Keep UI controls in sync even when language is applied programmatically (on boot).
		try {
			document.querySelectorAll('input[type="radio"][name="language"]').forEach((el) => {
				el.checked = el.dataset.language === lang;
			});
		} catch {}

		if (typeof onChange === 'function') onChange(lang);
	};

	const bindLanguageControls = () => {
		document.querySelectorAll('input[type="radio"][name="language"]').forEach(el => {
			el.addEventListener('change', (e) => {
				const button = e.target;
				void applyLanguage(button.dataset.language);
			});
		});
	};

	const bindThemeControls = () => {
		document.querySelectorAll('input[type="radio"][name="theme"]').forEach(el => {
			el.addEventListener('change', (e) => {
				if (!e.target.checked) return;
				accountEl?.classList.forEach(c => {
					if (c.match(/theme-/)) accountEl.classList.replace(c, `theme-${e.target.dataset.theme}`);
				});
			});
		});
	};

	const loadTranslation = async () => {
		try {
			const preferred = getPreferredLanguage();
			await ensureLang('en');
			if (preferred && preferred !== 'en') await ensureLang(preferred);
		} catch {
			// keep existing (possibly empty) state.translation
		}
	};

	return {
		t,
		applyLanguage,
		loadTranslation,
		bindLanguageControls,
		bindThemeControls,
	};
}


