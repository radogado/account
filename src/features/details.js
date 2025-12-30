export function initDetailsAnimation() {
	const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
	// Track animations so we can cancel + cleanup safely (prevents “stuck” fixed heights).
	const anims = new WeakMap(); // details -> Animation

	const cleanup = (content) => {
		content.style.height = '';
		content.style.opacity = '';
		content.style.overflow = '';
		content.style.willChange = '';
	};

	const stop = (details, content) => {
		const a = anims.get(details);
		if (a) a.cancel();
		anims.delete(details);
		if (content) cleanup(content);
	};

	const openAnimated = (details, content) => {
		stop(details, content);
		details.open = true;
		if (prefersReduced) return;
		content.style.overflow = 'hidden';
		content.style.willChange = 'height, opacity';
		content.style.height = '0px';
		content.style.opacity = '0';
		const target = content.scrollHeight;
		const a = content.animate(
			[{ height: '0px', opacity: 0 }, { height: `${target}px`, opacity: 1 }],
			{ duration: 180, easing: 'ease', fill: 'both' }
		);
		anims.set(details, a);
		a.onfinish = () => {
			anims.delete(details);
			// Remove the finished animation effect so height returns to auto (not a fixed px value).
			a.oncancel = null;
			a.cancel();
			cleanup(content);
		};
		a.oncancel = () => { anims.delete(details); cleanup(content); };
	};

	const closeAnimated = (details, content) => {
		stop(details, content);
		if (prefersReduced) { details.open = false; return; }
		content.style.overflow = 'hidden';
		content.style.willChange = 'height, opacity';
		const start = content.getBoundingClientRect().height;
		const a = content.animate(
			[{ height: `${start}px`, opacity: 1 }, { height: '0px', opacity: 0 }],
			{ duration: 180, easing: 'ease', fill: 'both' }
		);
		anims.set(details, a);
		a.onfinish = () => {
			anims.delete(details);
			// Keep the final 0px height applied until after the UA closes <details>
			// (prevents a snap back to auto height for one frame).
			content.style.height = '0px';
			content.style.opacity = '0';
			// Remove the finished animation effect (we rely on inline 0px while closing)
			a.oncancel = null;
			a.cancel();
			details.open = false;
			requestAnimationFrame(() => cleanup(content));
		};
		a.oncancel = () => { anims.delete(details); cleanup(content); };
	};

	document.querySelectorAll('main details').forEach(details => {
		const summary = details.querySelector(':scope > summary');
		const content = details.querySelector(':scope > .details__content');
		if (!summary || !content) return;
		summary.addEventListener('click', (e) => {
			e.preventDefault();
			if (details.open) closeAnimated(details, content);
			else openAnimated(details, content);
		});
	});
}


