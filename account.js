(function() {
	const init = () => {
		// Buttons ripple effect
		const ripple = e => {
			let el = e.target.closest('li') || e.target.closest('.btn');
			let x = e.clientX ? (e.clientX - el.offsetLeft) : el.clientWidth / 2;
			let y = e.clientY ? (e.clientY - el.offsetTop) : el.clientHeight / 2;
			let max_x = Math.max(x, el.clientWidth - x);
			let max_y = Math.max(y, el.clientHeight - y);
			let radius = Math.sqrt(max_x * max_x + max_y * max_y);
			// console.log(e.clientX - el.offsetLeft, e.clientY - el.offsetTop);
			el.style.transitionProperty = 'none';
			el.style.setProperty('--ripple-x', `${x}px`);
			el.style.setProperty('--ripple-y', `${y}px`);
			el.style.setProperty('--ripple-radius', `0px`);
			window.requestAnimationFrame(() => {
				el.style.transitionProperty = '';
				el.style.setProperty('--ripple-radius', `${radius}px`);
				// console.log(x, y, radius * 2);
			});
		}
		document.querySelectorAll('.btn, aside nav li').forEach(el => {
			el.addEventListener('pointerdown', ripple);
			el.addEventListener('keydown', ripple);
		});
		// Mobile/Desktop menu switching enhancement
		document.querySelector('#mobile-menu-trigger')?.addEventListener('change', e => {
			let main = document.querySelector('main');
			if (main) {
				if (e.target.checked) {
					main.inert = true;
				} else {
					main.inert = false;
				}
			}
		});
		document.querySelector('aside input[type="reset"]')?.addEventListener('click', e => {
			document.querySelector('main')?.removeAttribute('inert');
		});
		window.addEventListener('resize', e => {
			let toggle = document.querySelector('#mobile-menu-trigger');
			if (toggle && !toggle.clientWidth) { // Switching to desktop while mobile menu is closed
				document.querySelector('main')?.removeAttribute('inert');
				toggle.checked = false;
				let nav = document.querySelector('aside nav');
				nav.style.transition = 'none';
				setTimeout(() => {
					nav.style.transition = '';
				}, 1);
			}
			let logo = document.querySelector('aside .logo');
			logo.style.transition = 'none';
			setTimeout(() => {
				logo.style.transition = '';
			}, 1);
		}, { passive: true });
		document.querySelector('.account')?.setAttribute('data-ready', true);
	};
	if (document.readyState !== "loading") {
		init();
	} else {
		document.addEventListener("DOMContentLoaded", init);
	}
})();