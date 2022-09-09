(function() {
	const init = () => {
		document.querySelectorAll('.btn, aside nav li').forEach(el => el.onpointerdown = e => {
			let el = e.target.closest('li') || e.target.closest('.btn');
			let x = e.clientX - el.offsetLeft;
			let y = e.clientY - el.offsetTop;
			let max_x = Math.max(x, el.clientWidth - x);
			let max_y = Math.max(y, el.clientHeight - y);
			let radius = Math.sqrt(max_x * max_x + max_y * max_y);
			// console.log(e.clientX - el.offsetLeft, e.clientY - el.offsetTop);
			el.style.transitionProperty = 'none';
			el.style.setProperty('--ripple-x', `${x}px`);
			el.style.setProperty('--ripple-y', `${y}px`);
			el.style.transitionProperty = '';
			el.style.setProperty('--ripple-x', `${x}px`);
			el.style.setProperty('--ripple-y', `${y}px`);
			el.style.setProperty('--ripple-radius', `${radius}px`);
			console.log(x, y, radius * 2);
		});
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
			if (toggle && !toggle.clientWidth) {
				document.querySelector('main')?.removeAttribute('inert');
				toggle.checked = false;
			}
		}, { passive: true });
	};
	if (document.readyState !== "loading") {
		init();
	} else {
		document.addEventListener("DOMContentLoaded", init);
	}
})();
