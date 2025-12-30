export function initI18n({ state, onChange } = {}) {
	const accountEl = document.querySelector('.account');

	const t = (key, fallbackText = '') => {
		const lang = document.documentElement.lang || 'en';
		const dict = state?.translation?.[lang] || {};
		const fallback = state?.translation?.en || {};
		return dict[key] || fallback[key] || fallbackText || '';
	};

	const applyLanguage = (lang) => {
		if (!lang) return;
		accountEl?.style.setProperty('--transition-duration', 0);

		if (state?.translation && state.translation[lang]) {
			document.querySelectorAll('[data-text]').forEach(el => {
				const key = el.dataset.text;
				const dict = state.translation[lang] || {};
				const fallback = state.translation.en || {};
				el.innerHTML = dict[key] || fallback[key] || el.innerHTML;
			});
			document.documentElement.dir = state.translation[lang]._direction || 'ltr';
		}

		document.documentElement.lang = lang;
		setTimeout(() => accountEl?.style.removeProperty('--transition-duration'));

		if (typeof onChange === 'function') onChange(lang);
	};

	const bindLanguageControls = () => {
		document.querySelectorAll('input[type="radio"][name="language"]').forEach(el => {
			el.addEventListener('change', (e) => {
				const button = e.target;
				applyLanguage(button.dataset.language);
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
			const response = await fetch('translation.json');
			state.translation = await response.json();
		} catch {
			state.translation = null;
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


