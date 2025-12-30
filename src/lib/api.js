export async function api(path, { method = 'GET', body } = {}) {
	const res = await fetch(path, {
		method,
		credentials: 'same-origin',
		headers: body ? { 'Content-Type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});

	const ct = res.headers.get('content-type') || '';
	let data = null;
	if (ct.includes('application/json')) {
		try { data = await res.json(); } catch { data = null; }
	} else {
		try { data = await res.text(); } catch { data = null; }
	}

	if (!res.ok) {
		const msg = (data && data.error) ? data.error : (typeof data === 'string' ? data : 'Request failed');
		const err = new Error(msg);
		err.status = res.status;
		err.data = data;
		throw err;
	}
	return data;
}


