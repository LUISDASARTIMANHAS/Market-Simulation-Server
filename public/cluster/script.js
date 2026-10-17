import { request, formatTime, setConnectionState } from "/src/js/common.js";

const REFRESH_MS = 5000;
const $ = (selector) => document.querySelector(selector);

const elements = {
	content: $("#cluster-content"),
	feedback: $("#feedback"),
	pull: $("#btn-pull"),
	push: $("#btn-push"),
	refresh: $("#btn-refresh"),
	nodesSection: $("#nodes-section"),
	nodesBody: $("#nodes-body"),
};

/**
 * Exibe uma mensagem de retorno ao administrador.
 * @param {string} message
 * @param {boolean} [isError=false]
 * @returns {void}
 */
function notify(message, isError = false) {
	elements.feedback.textContent = message;
	elements.feedback.className = `alert ${isError ? "alert-danger" : "alert-success"}`;
}

/**
 * Cria uma célula de tabela com texto seguro (sem innerHTML).
 * @param {string} text
 * @param {string} [className]
 * @returns {HTMLTableCellElement}
 */
function cell(text, className = "") {
	const td = document.createElement("td");
	td.textContent = text;
	if (className) td.className = className;
	return td;
}

function formatSyncInterval(intervalMs) {
	if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) return "—";
	const seconds = intervalMs / 1000;
	if (seconds % 3600 === 0) return `${seconds / 3600} h`;
	if (seconds % 60 === 0) return `${seconds / 60} min`;
	return `${seconds} s`;
}

function accessCell(node) {
	const td = document.createElement("td");
	try {
		const url = new URL(node.url);
		if (!["http:", "https:"].includes(url.protocol)) throw new Error("URL inválida");
		const link = document.createElement("a");
		link.href = url.href;
		link.target = "_blank";
		link.rel = "noopener noreferrer";
		link.textContent = "Abrir";
		link.setAttribute("aria-label", `Abrir node ${node.nodeId}`);
		td.append(link);
	} catch {
		td.textContent = "—";
		td.className = "text-secondary";
	}
	return td;
}

function renderSelf(status) {
	$("#st-role").textContent = status.role ?? "—";
	$("#st-sync-mode").textContent = status.syncMode ?? "—";
	$("#st-sync-interval").textContent = formatSyncInterval(status.syncIntervalMs);
	$("#st-node").textContent = status.nodeId ?? "—";
	$("#st-local").textContent = status.localSequence ?? "—";
	$("#st-master").textContent = status.masterSequence ?? "—";
	$("#st-lag").textContent = status.sequenceLag ?? "—";
	$("#st-dirty").textContent = status.isDirty ? "Sim" : "Não";
	$("#st-pull").textContent = formatTime(status.lastPullAt);
	$("#st-push").textContent = formatTime(status.lastPushAt);
	$("#st-url").textContent = status.masterUrl ?? "—";
	$("#st-error").textContent = status.lastSyncError ?? "nenhum";

	const isNode = status.role === "node";
	elements.pull.disabled = !isNode;
	elements.push.disabled = !isNode;
}

function renderNodes(nodes) {
	elements.nodesBody.replaceChildren();
	if (!nodes.length) {
		const tr = document.createElement("tr");
		const td = cell("Nenhum node registrado.", "text-center text-secondary");
		td.colSpan = 11;
		tr.append(td);
		elements.nodesBody.append(tr);
		return;
	}

	for (const node of nodes) {
		const tr = document.createElement("tr");
		tr.append(
			cell(node.nodeId ?? "—", "text-break font-monospace small"),
			cell(node.appVersion ?? "—"),
			cell(String(node.port ?? "—")),
			accessCell(node),
			cell(
				node.status ?? "—",
				node.status === "online" ? "text-success fw-semibold" : "text-danger",
			),
			cell(String(node.localSequence ?? "—")),
			cell(String(node.sequenceLag ?? "—")),
			cell(formatSyncInterval(node.syncIntervalMs)),
			cell(String(node.successfulPushes ?? 0)),
			cell(String(node.rejectedPushes ?? 0)),
			cell(formatTime(node.lastSeenAt)),
		);
		elements.nodesBody.append(tr);
	}
}

function render(data) {
	renderSelf(data.status);
	const isMaster = data.status.role === "master";
	elements.nodesSection.hidden = !isMaster;
	if (isMaster && Array.isArray(data.nodes)) {
		renderNodes(data.nodes);
	}
}

async function load() {
	try {
		render(await request("/admin/cluster"));
		setConnectionState(true, "Cluster acessível");
	} catch (error) {
		setConnectionState(false, "Falha ao consultar cluster");
		notify(error.message, true);
	}
}

/**
 * @param {"pull" | "push"} action
 * @param {string} confirmation
 * @returns {Promise<void>}
 */
async function runAction(action, confirmation) {
	if (!window.confirm(confirmation)) return;
	elements.pull.disabled = true;
	elements.push.disabled = true;
	try {
		render(await request(`/admin/cluster/${action}`, { method: "POST" }));
		notify(
			action === "pull"
				? "Estado do master aplicado."
				: "Estado enviado ao master.",
		);
	} catch (error) {
		notify(error.message, true);
		await load();
	}
}

/** @returns {Promise<void>} */
async function requireAdmin() {
	try {
		const data = await request("/account");
		if (!data.account?.isAdmin)
			throw new Error("Acesso administrativo necessário.");
	} catch {
		window.location.replace("/wallet");
		return;
	}
	elements.content.hidden = false;
	await load();
	window.setInterval(load, REFRESH_MS);
}

elements.refresh.addEventListener("click", load);
elements.pull.addEventListener("click", () =>
	runAction(
		"pull",
		"Baixar o estado do master? Os dados locais serão substituídos.",
	),
);
elements.push.addEventListener("click", () =>
	runAction(
		"push",
		"Enviar o estado local ao master? Se este node estiver atrasado, o master recusará e o estado dele será baixado.",
	),
);

requireAdmin();

