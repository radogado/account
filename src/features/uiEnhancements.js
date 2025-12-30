export function initUiEnhancements() {
	// Buttons ripple effect
	const ripple = (e) => {
		const el = e.target.closest('li') || e.target.closest('.btn');
		if (!el) return;
		const x = e.offsetX || el.clientWidth / 2;
		const y = e.offsetY || el.clientHeight / 2;
		const max_x = Math.max(x, el.clientWidth - x);
		const max_y = Math.max(y, el.clientHeight - y);
		const radius = Math.sqrt(max_x * max_x + max_y * max_y);
		el.style.transitionProperty = 'none';
		el.style.setProperty('--ripple-x', `${x}px`);
		el.style.setProperty('--ripple-y', `${y}px`);
		el.style.setProperty('--ripple-radius', `0px`);
		window.requestAnimationFrame(() => {
			el.style.transitionProperty = '';
			el.style.setProperty('--ripple-radius', `${radius}px`);
		});
	};
	document.querySelectorAll('.btn, aside nav li').forEach(el => {
		el.addEventListener('pointerdown', ripple);
		el.addEventListener('keydown', ripple);
	});

	// Mobile/Desktop menu switching enhancement
	document.querySelectorAll('.account__trigger').forEach(el => {
		const checked = !!el.checked;
		if (checked) {
			el.removeAttribute('checked');
			el.setAttribute('aria-expanded', true);
		}
		el.outerHTML = el.outerHTML.replace('input', 'button').replace('checkbox', 'button');
	});
	document.querySelectorAll('.account__trigger').forEach(el => {
		// Add aria-expanded toggle event on click
		el.addEventListener('click', (e) => {
			const btn = e.target.closest('button');
			btn.setAttribute('aria-expanded', btn.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
		});
	});
	document.querySelector('#mobile-menu-trigger')?.addEventListener('click', (e) => {
		const main = document.querySelector('main');
		if (!main) return;
		if (e.target.getAttribute('aria-expanded') === 'true') main.inert = true;
		else main.inert = false;
	});
	document.querySelector('.account aside input[type="reset"]')?.addEventListener('click', (e) => {
		document.querySelector(`button[form="${e.target.getAttribute('form')}"]`)?.click();
		document.querySelector('main')?.removeAttribute('inert');
	});

	let transition_timeout;
	window.addEventListener('resize', () => {
		const toggle = document.querySelector('#mobile-menu-trigger');
		if (toggle && !toggle.clientWidth) {
			// Switching to desktop while mobile menu is closed
			document.querySelector('main')?.removeAttribute('inert');
			toggle.removeAttribute('aria-expanded');
		}
		const account = document.querySelector('.account');
		if (!account) return;
		account.style.setProperty('--transition-duration', 0);
		getComputedStyle(account);
		clearTimeout(transition_timeout);
		transition_timeout = setTimeout(() => {
			account.style.removeProperty('--transition-duration', 0);
		}, 100);
	}, { passive: true });

	document.querySelector('.account')?.setAttribute('data-ready', true);
	document.querySelector('.account')?.addEventListener('click', (e) => {
		// Only close the profile dropdown; other <details> (FAQ/promos) should be user-controlled.
		if (!e.target.closest('.header__profile')) {
			document.querySelectorAll('details.header__profile[open]').forEach(el => { el.open = false; });
		}
	});
}


