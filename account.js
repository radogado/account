(function() {
	const init = () => {
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
		document.querySelectorAll('button[data-translate-to]').forEach(el => {
			el.addEventListener('click', e => {
				let button = e.target.closest('button');
				document.querySelector('.account').style.setProperty('--transition-duration', 0);
				document.querySelectorAll('[data-text]').forEach(el => {
					el.innerText = translation[button.dataset.translateTo][el.dataset.text] || el.innerText;
				});
				document.documentElement.dir = translation[button.dataset.translateTo]._direction || 'ltr';
				document.documentElement.lang = button.dataset.translateTo;
				setTimeout(() => document.querySelector('.account').style.removeProperty('--transition-duration'));
			});
		});
	};
	if (document.readyState !== "loading") {
		init();
	} else {
		document.addEventListener("DOMContentLoaded", init);
	}
})();