import { request, formatTime, setConnectionState } from "./common.js";

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
		td.textContent = "Não configurado";
	}
	return td;
}

/**
 * Renderiza a tabela de nodes (apenas no master).
 * @param {Array<object>} nodes
 * @returns {void}
 */
function renderNodes(nodes = []) {
	elements.nodesBody.replaceChildren();
	if (!nodes.length) {
		const row = document.createElement("tr");
		const td = cell("Nenhum node registrado.", "text-center text-secondary");
		td.colSpan = 10;
		row.append(td);
		elements.nodesBody.append(row);
		return;
	}
	for (const node of nodes) {
		const row = document.createElement("tr");
		const badge = document.createElement("td");
		const span = document.createElement("span");
		span.className = `badge ${node.online ? "text-bg-success" : "text-bg-secondary"}`;
		span.textContent = node.online ? "Online" : "Offline";
		badge.append(span);
		row.append(
			cell(node.nodeId),
			cell(node.version ?? "—"),
			cell(Number.isInteger(node.port) ? String(node.port) : "—"),
			accessCell(node),
			badge,
			cell(node.reportedRevision ?? "—"),
			cell(
				node.behindBy === null
					? "—"
					: node.behindBy === 0
						? "Em dia"
						: `${node.behindBy} Sincronizações(ões)`,
				node.behindBy > 0 ? "text-warning" : "",
			),
			cell(node.pushes),
			cell(node.conflicts),
			cell(formatTime(node.lastSeenAt)),
		);
		elements.nodesBody.append(row);
	}
}

/**
 * Atualiza o painel com o estado do cluster.
 * @param {object} data
 * @returns {void}
 */
function render(data) {
	const roleLabels = {
		master: "Master",
		node: "Node",
		standalone: "Independente",
	};
	const syncModeLabels = {
		"bidirectional": "Envio e recebimento",
		"receive-only": "Somente recebimento",
	};
	$("#st-role").textContent = roleLabels[data.role] ?? data.role;
	$("#st-sync-mode").textContent = syncModeLabels[data.syncMode] ?? "—";
	$("#st-node").textContent = data.nodeId ?? "—";
	$("#st-local").textContent = data.syncEnabled ? data.localRevision : "—";
	$("#st-master").textContent = Number.isInteger(data.masterRevision)
		? data.masterRevision
		: "—";
	$("#st-lag").textContent =
		data.lag === null || data.lag === undefined
			? "—"
			: data.lag === 0
				? "Em dia"
				: `${data.lag} Sincronizações(ões)`;
	$("#st-dirty").textContent =
		data.role === "node" ? (data.dirty ? "Sim" : "Não") : "—";
	$("#st-pull").textContent = formatTime(data.lastPullAt);
	$("#st-push").textContent = formatTime(data.lastPushAt);
	$("#st-url").textContent = data.masterUrl ?? "—";
	$("#st-error").textContent = data.lastError
		? `${data.lastError.message} (${formatTime(data.lastError.at)})`
		: "nenhum";

	const isNode = data.role === "node";
	elements.pull.disabled = !isNode;
	elements.push.disabled = !data.canPush;
	elements.nodesSection.hidden = data.role !== "master";
	if (data.role === "master") renderNodes(data.nodes);
	if (!data.syncEnabled)
		notify(
			"Este servidor está em modo independente (MARKET_SYNC_ROLE=standalone).",
			false,
		);
}

/** @returns {Promise<void>} */
async function load() {
	try {
		render(await request("/admin/cluster/status"));
		setConnectionState(true, "Administrador conectado");
	} catch (error) {
		setConnectionState(false);
		notify(error.message, true);
	}
}

/**
 * Executa uma ação manual com confirmação.
 * @param {'pull'|'push'} action
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
		window.location.replace("/wallet.html");
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
