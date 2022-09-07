(function() {
	const init = () => {
		document.querySelectorAll('button, aside nav a').forEach(el => el.onpointerdown = e => {
			let el = e.target.closest('button, a');
			let diameter = Math.max(el.clientWidth, el.clientHeight);
			let x = e.clientX - el.offsetLeft - diameter;
			let y = e.clientY - el.offsetTop - diameter;
			el.style.setProperty('--ripple-x', `${x}px`);
			el.style.setProperty('--ripple-y', `${y}px`);
			el.style.setProperty('--ripple-diameter', `${diameter * 2}px`);
			console.log(x, y);
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
	}
	if (document.readyState !== "loading") {
		init();
	} else {
		document.addEventListener("DOMContentLoaded", init);
	}
})();
