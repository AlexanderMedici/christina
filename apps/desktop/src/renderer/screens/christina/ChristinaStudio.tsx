import { Badge } from "@superset/ui/badge";
import { Button } from "@superset/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@superset/ui/card";
import { Checkbox } from "@superset/ui/checkbox";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { Progress } from "@superset/ui/progress";
import { ScrollArea } from "@superset/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { Separator } from "@superset/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superset/ui/tabs";
import { Textarea } from "@superset/ui/textarea";
import { toast } from "@superset/ui/sonner";
import {
	AlertTriangle,
	BookOpen,
	Bot,
	BrainCircuit,
	CheckCircle2,
	Clock3,
	Download,
	FolderOpen,
	Gauge,
	Library,
	MessageSquareText,
	Play,
	RefreshCw,
	Route,
	ShieldCheck,
	Sparkles,
	Trash2,
	Users,
	XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { MarkdownRenderer } from "renderer/components/MarkdownRenderer";
import { electronTrpc } from "renderer/lib/electron-trpc";

const SPECIALISTS = [
	"RESEARCHER",
	"CODER",
	"FACT_CHECKER",
	"SUMMARIZER",
	"TOOL_EXECUTOR",
	"CRITIC",
] as const;

type SpecialistId = (typeof SPECIALISTS)[number];
type SafetyMode = "review" | "workspace" | "unrestricted";
type LocalPolicy = "local-only" | "prefer-local" | "balanced" | "cloud-first";
type BookMode = "answer" | "teach" | "quiz" | "study-guide";

function formatDate(value?: string) {
	if (!value) return "—";
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

function statusBadge(status: string) {
	if (["completed", "ready", "approved", "active", "healthy"].includes(status)) {
		return <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/20">{status}</Badge>;
	}
	if (["running", "scanning", "pending"].includes(status)) {
		return <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/20">{status}</Badge>;
	}
	if (["failed", "error", "denied", "unavailable"].includes(status)) {
		return <Badge variant="destructive">{status}</Badge>;
	}
	return <Badge variant="secondary">{status}</Badge>;
}

function EmptyState({ icon: Icon, title, description }: { icon: typeof Bot; title: string; description: string }) {
	return (
		<div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 p-8 text-center">
		<Icon className="mb-3 size-9 text-muted-foreground" />
		<h3 className="font-medium">{title}</h3>
		<p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
		</div>
	);
}

function StatCard({ label, value, icon: Icon, description }: { label: string; value: string | number; icon: typeof Bot; description: string }) {
	return (
		<Card className="gap-3 py-4">
			<CardContent className="flex items-start justify-between px-4">
				<div>
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
					<p className="mt-1 text-2xl font-semibold">{value}</p>
					<p className="mt-1 text-xs text-muted-foreground">{description}</p>
				</div>
				<div className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="size-5" /></div>
			</CardContent>
		</Card>
	);
}

function OrchestratorTab() {
	const { data: homeDir } = electronTrpc.window.getHomeDir.useQuery();
	const utils = electronTrpc.useUtils();
	const [request, setRequest] = useState("");
	const [cwd, setCwd] = useState("");
	const [safetyMode, setSafetyMode] = useState<SafetyMode>("workspace");
	const [localPolicy, setLocalPolicy] = useState<LocalPolicy>("prefer-local");
	const [selectedAgents, setSelectedAgents] = useState<SpecialistId[]>([]);
	const [previewRequest, setPreviewRequest] = useState("");
	const [selectedOrchestrationId, setSelectedOrchestrationId] = useState<string | null>(null);

	useEffect(() => {
		if (!cwd && homeDir) setCwd(homeDir);
	}, [homeDir, cwd]);

	const preview = electronTrpc.agentKernel.routeChristina.useQuery(
		{ request: previewRequest || "preview", explicitAgents: selectedAgents.length ? selectedAgents : undefined },
		{ enabled: Boolean(previewRequest) },
	);
	const orchestrations = electronTrpc.agentKernel.orchestrations.useQuery(undefined, { refetchInterval: 1800 });
	const selected = electronTrpc.agentKernel.orchestration.useQuery(
		{ id: selectedOrchestrationId ?? "00000000-0000-0000-0000-000000000000" },
		{ enabled: Boolean(selectedOrchestrationId), refetchInterval: 1200 },
	);
	const start = electronTrpc.agentKernel.startChristina.useMutation({
		onSuccess: (result) => {
			setSelectedOrchestrationId(result.id);
			void utils.agentKernel.orchestrations.invalidate();
			toast.success("CHRISTINA started the specialist swarm");
		},
		onError: (error) => toast.error("Could not start CHRISTINA", { description: error.message }),
	});
	const cancel = electronTrpc.agentKernel.cancelChristina.useMutation({
		onSuccess: () => {
			void utils.agentKernel.orchestrations.invalidate();
			toast.success("Orchestration cancelled");
		},
	});
	const selectDirectory = electronTrpc.window.selectDirectory.useMutation();

	useEffect(() => {
		if (!selectedOrchestrationId && orchestrations.data?.[0]?.id) {
			setSelectedOrchestrationId(orchestrations.data[0].id);
		}
	}, [orchestrations.data, selectedOrchestrationId]);

	const current = selected.data;
	const completed = current?.contributions.filter((item) => item.status === "completed").length ?? 0;
	const total = current?.routePlan.subtasks.length ?? 0;
	const progress = total ? Math.round((completed / total) * 100) : 0;

	const toggleAgent = (agent: SpecialistId) => {
		setSelectedAgents((currentAgents) =>
			currentAgents.includes(agent)
				? currentAgents.filter((item) => item !== agent)
				: [...currentAgents, agent],
		);
	};

	const browse = async () => {
		const result = await selectDirectory.mutateAsync({ title: "Choose the working folder for CHRISTINA", defaultPath: cwd || homeDir });
		if (!result.canceled && result.path) setCwd(result.path);
	};

	const startRun = () => {
		if (!request.trim()) {
			toast.error("Enter a request for CHRISTINA");
			return;
		}
		if (!cwd.trim()) {
			toast.error("Choose a working folder");
			return;
		}
		start.mutate({
			request: request.trim(),
			workspaceId: "christina-desktop",
			cwd,
			safetyMode,
			explicitAgents: selectedAgents.length ? selectedAgents : undefined,
			localModelPolicy: localPolicy,
			minimumLocalModelScore: 60,
		});
	};

	return (
		<div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
			<div className="space-y-5">
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2"><BrainCircuit className="size-5 text-primary" /> Ask CHRISTINA</CardTitle>
						<CardDescription>Describe the outcome. CHRISTINA will route the request to the best specialist agents and synthesize the final answer.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-5">
						<div className="space-y-2">
							<Label htmlFor="christina-request">Request</Label>
							<Textarea id="christina-request" value={request} onChange={(event) => setRequest(event.target.value)} placeholder="Example: Review this Node API, identify security issues, fix the code, and summarize the changes." className="min-h-36 resize-y" />
						</div>
						<div className="space-y-2">
							<Label>Working folder</Label>
							<div className="flex gap-2">
								<Input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="C:\\Projects\\MyApp" />
								<Button variant="outline" onClick={browse}><FolderOpen className="size-4" /> Browse</Button>
							</div>
						</div>
						<div className="grid gap-4 md:grid-cols-2">
							<div className="space-y-2">
								<Label>Model policy</Label>
								<Select value={localPolicy} onValueChange={(value) => setLocalPolicy(value as LocalPolicy)}>
									<SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
									<SelectContent>
										<SelectItem value="local-only">Local only</SelectItem>
										<SelectItem value="prefer-local">Prefer local</SelectItem>
										<SelectItem value="balanced">Balanced</SelectItem>
										<SelectItem value="cloud-first">Cloud first</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-2">
								<Label>Safety mode</Label>
								<Select value={safetyMode} onValueChange={(value) => setSafetyMode(value as SafetyMode)}>
									<SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
									<SelectContent>
										<SelectItem value="review">Review only</SelectItem>
										<SelectItem value="workspace">Workspace</SelectItem>
										<SelectItem value="unrestricted">Unrestricted</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>
						<div className="space-y-3">
							<div className="flex items-center justify-between"><Label>Specialists</Label><span className="text-xs text-muted-foreground">Leave empty for automatic routing</span></div>
							<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
								{SPECIALISTS.map((agent) => (
									<label key={agent} className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm hover:bg-muted/50">
										<Checkbox checked={selectedAgents.includes(agent)} onCheckedChange={() => toggleAgent(agent)} />
										<span>{agent.replace("_", " ")}</span>
									</label>
								))}
							</div>
						</div>
						<div className="flex flex-wrap gap-2">
							<Button variant="outline" onClick={() => setPreviewRequest(request.trim())} disabled={!request.trim() || preview.isFetching}><Route className="size-4" /> Preview route</Button>
							<Button onClick={startRun} disabled={start.isPending}><Play className="size-4" /> {start.isPending ? "Starting…" : "Start orchestration"}</Button>
						</div>
					</CardContent>
				</Card>

				{preview.data && (
					<Card>
						<CardHeader><CardTitle className="text-base">Routing preview</CardTitle><CardDescription>{preview.data.plan.subtasks.length} specialists selected</CardDescription></CardHeader>
						<CardContent className="space-y-3">
							{preview.data.plan.subtasks.map((task) => (
								<div key={task.id} className="rounded-lg border p-3"><div className="flex items-center justify-between"><strong className="text-sm">{task.agentId}</strong><Badge variant="outline">{task.dependencies.length ? `after ${task.dependencies.length}` : "parallel"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{task.title}</p></div>
							))}
						</CardContent>
					</Card>
				)}
			</div>

			<div className="space-y-5">
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center justify-between"><span className="flex items-center gap-2"><Users className="size-5" /> Live swarm</span>{current && statusBadge(current.status)}</CardTitle>
						<CardDescription>{current ? `Started ${formatDate(current.createdAt)}` : "Select or start an orchestration"}</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{!current ? <EmptyState icon={Users} title="No active swarm" description="Start a request on the left. Specialist progress will appear here." /> : (
							<>
								<div><div className="mb-2 flex justify-between text-xs text-muted-foreground"><span>{completed} of {total} specialists completed</span><span>{progress}%</span></div><Progress value={progress} /></div>
								<div className="grid gap-2">
									{current.routePlan.subtasks.map((task) => {
										const contribution = current.contributions.find((item) => item.subtaskId === task.id);
										return <div key={task.id} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-2"><span className="font-medium text-sm">{task.agentId}</span>{statusBadge(contribution?.status ?? task.status)}</div><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{contribution?.output || task.title}</p>{contribution?.model && <p className="mt-2 text-[11px] text-muted-foreground">{contribution.runtimeId} · {contribution.model}{typeof contribution.localModelScore === "number" ? ` · score ${contribution.localModelScore}` : ""}</p>}</div>;
									})}
								</div>
								{current.confidence && <div className="rounded-lg bg-muted/50 p-4"><div className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm font-medium"><Gauge className="size-4" /> Confidence</span><span className="text-xl font-semibold">{current.confidence.score}%</span></div><Progress className="mt-2" value={current.confidence.score} /><ul className="mt-3 space-y-1 text-xs text-muted-foreground">{current.confidence.reasons.slice(0, 3).map((reason) => <li key={reason}>• {reason}</li>)}</ul></div>}
								{current.status === "running" && <Button variant="destructive" size="sm" onClick={() => cancel.mutate({ id: current.id })}>Cancel swarm</Button>}
							</>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="size-5 text-primary" /> Final response</CardTitle></CardHeader>
					<CardContent>
						{current?.finalResponse ? <ScrollArea className="max-h-[440px] pr-4"><MarkdownRenderer content={current.finalResponse} /></ScrollArea> : <EmptyState icon={MessageSquareText} title="Waiting for synthesis" description="CHRISTINA will create one unified response after all routed specialists have responded." />}
					</CardContent>
				</Card>

				<Card>
					<CardHeader><CardTitle className="text-base">Recent orchestrations</CardTitle></CardHeader>
					<CardContent className="space-y-2">
						{orchestrations.data?.slice(0, 6).map((item) => <button type="button" key={item.id} onClick={() => setSelectedOrchestrationId(item.id)} className={`w-full rounded-lg border p-3 text-left transition ${selectedOrchestrationId === item.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}><div className="flex items-center justify-between gap-2">{statusBadge(item.status)}<span className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</span></div><p className="mt-2 line-clamp-2 text-sm">{item.originalRequest}</p></button>)}
						{!orchestrations.data?.length && <p className="text-sm text-muted-foreground">No runs yet.</p>}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

function ModelsTab() {
	const utils = electronTrpc.useUtils();
	const providers = electronTrpc.agentKernel.localModelProviders.useQuery(undefined, { refetchInterval: 5000 });
	const models = electronTrpc.agentKernel.localModels.useQuery({ refresh: false });
	const [pullModel, setPullModel] = useState("qwen2.5:7b");
	const pull = electronTrpc.agentKernel.pullOllamaModel.useMutation({
		onSuccess: () => { toast.success("Model downloaded"); void utils.agentKernel.localModels.invalidate(); void utils.agentKernel.localModelProviders.invalidate(); },
		onError: (error) => toast.error("Model download failed", { description: error.message }),
	});
	const openUrl = electronTrpc.external.openUrl.useMutation();
	const refresh = async () => {
		await Promise.all([providers.refetch(), utils.agentKernel.localModels.fetch({ refresh: true })]);
		toast.success("Local model inventory refreshed");
	};
	return (
		<div className="space-y-5">
			<div className="grid gap-4 md:grid-cols-3">
				<StatCard label="Providers" value={providers.data?.providers.length ?? 0} icon={Bot} description="Ollama, LM Studio, and compatible endpoints" />
				<StatCard label="Models" value={models.data?.length ?? 0} icon={BrainCircuit} description="Discovered models available to specialists" />
				<StatCard label="System RAM" value={providers.data ? `${Math.round(providers.data.systemMemory.totalBytes / 1024 ** 3)} GB` : "—"} icon={Gauge} description="Used to score model hardware fit" />
			</div>
			<div className="flex flex-wrap gap-2"><Button onClick={refresh} variant="outline"><RefreshCw className="size-4" /> Refresh</Button><Button variant="outline" onClick={() => openUrl.mutate("https://ollama.com/download/windows")}><Download className="size-4" /> Get Ollama</Button></div>
			<div className="grid gap-4 lg:grid-cols-2">
				<Card><CardHeader><CardTitle>Provider health</CardTitle><CardDescription>CHRISTINA only routes local work to healthy providers.</CardDescription></CardHeader><CardContent className="space-y-3">{providers.data?.providers.map((provider) => <div key={provider.id} className="rounded-lg border p-4"><div className="flex items-center justify-between"><div><p className="font-medium">{provider.label}</p><p className="text-xs text-muted-foreground">{provider.baseUrl}</p></div>{statusBadge(provider.health.available ? "healthy" : "unavailable")}</div><p className="mt-2 text-sm text-muted-foreground">{provider.modelCount} models · {provider.kind}</p>{provider.health.detail && <p className="mt-1 text-xs text-muted-foreground">{provider.health.detail}</p>}</div>)}{!providers.data?.providers.length && <EmptyState icon={Bot} title="No local provider found" description="Install and start Ollama or LM Studio, then press Refresh." />}</CardContent></Card>
				<Card><CardHeader><CardTitle>Download an Ollama model</CardTitle><CardDescription>No PowerShell required. Enter a model name and CHRISTINA will run the download.</CardDescription></CardHeader><CardContent className="space-y-3"><Input value={pullModel} onChange={(event) => setPullModel(event.target.value)} placeholder="qwen2.5:7b" /><Button onClick={() => pull.mutate({ model: pullModel })} disabled={pull.isPending || !pullModel.trim()}><Download className="size-4" /> {pull.isPending ? "Downloading…" : "Download model"}</Button><p className="text-xs text-muted-foreground">Good starting options: qwen2.5:7b, qwen2.5-coder:7b, llama3.1:8b.</p></CardContent></Card>
			</div>
			<Card><CardHeader><CardTitle>Discovered models</CardTitle></CardHeader><CardContent>{models.data?.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{models.data.map((model) => <div key={model.id} className="rounded-lg border p-4"><div className="flex items-start justify-between gap-2"><div><p className="font-medium">{model.displayName}</p><p className="text-xs text-muted-foreground">{model.providerLabel}</p></div>{model.loaded && <Badge className="bg-emerald-500/15 text-emerald-600">loaded</Badge>}</div><div className="mt-3 flex flex-wrap gap-1">{model.capabilities.reasoning && <Badge variant="outline">reasoning</Badge>}{model.capabilities.toolCalling && <Badge variant="outline">tools</Badge>}{model.capabilities.vision && <Badge variant="outline">vision</Badge>}{model.parameterSize && <Badge variant="outline">{model.parameterSize}</Badge>}</div></div>)}</div> : <EmptyState icon={BrainCircuit} title="No models discovered" description="Start a local model server and refresh this page." />}</CardContent></Card>
		</div>
	);
}

function LibrariesTab() {
	const utils = electronTrpc.useUtils();
	const libraries = electronTrpc.agentKernel.bookLibraries.useQuery(undefined, { refetchInterval: 3000 });
	const [name, setName] = useState("");
	const [sourcePath, setSourcePath] = useState("");
	const selectDirectory = electronTrpc.window.selectDirectory.useMutation();
	const create = electronTrpc.agentKernel.createBookLibrary.useMutation({
		onSuccess: () => { setName(""); setSourcePath(""); void utils.agentKernel.bookLibraries.invalidate(); toast.success("Private library created"); },
		onError: (error) => toast.error("Could not create library", { description: error.message }),
	});
	const scan = electronTrpc.agentKernel.scanBookLibrary.useMutation({
		onSuccess: (result) => { void utils.agentKernel.bookLibraries.invalidate(); toast.success(`Indexed ${result.indexed} books`); },
		onError: (error) => toast.error("Scan failed", { description: error.message }),
	});
	const remove = electronTrpc.agentKernel.deleteBookLibrary.useMutation({
		onSuccess: () => { void utils.agentKernel.bookLibraries.invalidate(); toast.success("Library index removed; original books were not changed"); },
	});
	const browse = async () => {
		const result = await selectDirectory.mutateAsync({ title: "Select a book folder or external drive" });
		if (!result.canceled && result.path) setSourcePath(result.path);
	};
	return <div className="space-y-5"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Library className="size-5" /> Add private book library</CardTitle><CardDescription>Point CHRISTINA at a local folder, external drive, or mounted network folder. Files stay in place.</CardDescription></CardHeader><CardContent className="grid gap-4 lg:grid-cols-[1fr_2fr_auto]"><div className="space-y-2"><Label>Library name</Label><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="MERN Books" /></div><div className="space-y-2"><Label>Folder path</Label><Input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} placeholder="E:\\Books" /></div><div className="flex items-end gap-2"><Button variant="outline" onClick={browse}><FolderOpen className="size-4" /> Browse</Button><Button onClick={() => create.mutate({ name, sourcePath, recursive: true, followSymlinks: false })} disabled={!name.trim() || !sourcePath.trim() || create.isPending}>Add library</Button></div></CardContent></Card><div className="grid gap-4 lg:grid-cols-2">{libraries.data?.map((library) => <Card key={library.id} className="gap-4"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-base">{library.name}</CardTitle><CardDescription className="mt-1 break-all">{library.sourcePath}</CardDescription></div>{statusBadge(library.status)}</div></CardHeader><CardContent className="space-y-4"><div className="grid grid-cols-3 gap-3 text-center"><div className="rounded-lg bg-muted p-3"><p className="text-xl font-semibold">{library.documentCount}</p><p className="text-xs text-muted-foreground">documents</p></div><div className="rounded-lg bg-muted p-3"><p className="text-xl font-semibold">{library.chunkCount}</p><p className="text-xs text-muted-foreground">passages</p></div><div className="rounded-lg bg-muted p-3"><p className="text-xs font-medium">{formatDate(library.lastScannedAt)}</p><p className="text-xs text-muted-foreground">last scan</p></div></div>{library.error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{library.error}</p>}<div className="flex gap-2"><Button size="sm" onClick={() => scan.mutate({ libraryId: library.id })} disabled={scan.isPending}><RefreshCw className="size-4" /> Scan</Button><Button size="sm" variant="outline" onClick={() => remove.mutate({ libraryId: library.id })}><Trash2 className="size-4" /> Remove index</Button></div></CardContent></Card>)}{!libraries.data?.length && <div className="lg:col-span-2"><EmptyState icon={Library} title="No private libraries" description="Add a book folder above. CHRISTINA will create a local passage index without modifying the source files." /></div>}</div></div>;
}

function TutorsTab() {
	const utils = electronTrpc.useUtils();
	const libraries = electronTrpc.agentKernel.bookLibraries.useQuery();
	const models = electronTrpc.agentKernel.localModels.useQuery({ refresh: false });
	const agents = electronTrpc.agentKernel.knowledgeAgents.useQuery(undefined, { refetchInterval: 3000 });
	const [name, setName] = useState("My Book Tutor");
	const [libraryId, setLibraryId] = useState("");
	const [modelId, setModelId] = useState("");
	const [style, setStyle] = useState<"socratic" | "direct" | "step-by-step" | "exam-prep">("step-by-step");
	const [selectedAgentId, setSelectedAgentId] = useState("");
	const [mode, setMode] = useState<BookMode>("teach");
	const [question, setQuestion] = useState("");
	const [answer, setAnswer] = useState<string | null>(null);
	const [citations, setCitations] = useState<string[]>([]);
	const create = electronTrpc.agentKernel.createKnowledgeAgent.useMutation({
		onSuccess: (profile) => { setSelectedAgentId(profile.id); void utils.agentKernel.knowledgeAgents.invalidate(); toast.success("Private tutor created"); },
		onError: (error) => toast.error("Could not create tutor", { description: error.message }),
	});
	const ask = electronTrpc.agentKernel.askKnowledgeAgent.useMutation({
		onSuccess: (result) => { setAnswer(result.run.outputText ?? "The tutor completed without text output."); setCitations(result.citations); },
		onError: (error) => toast.error("Tutor request failed", { description: error.message }),
	});
	useEffect(() => { if (!libraryId && libraries.data?.[0]?.id) setLibraryId(libraries.data[0].id); }, [libraries.data, libraryId]);
	useEffect(() => { if (!modelId && models.data?.[0]?.id) setModelId(models.data[0].id); }, [models.data, modelId]);
	useEffect(() => { if (!selectedAgentId && agents.data?.[0]?.id) setSelectedAgentId(agents.data[0].id); }, [agents.data, selectedAgentId]);
	const selectedModel = models.data?.find((item) => item.id === modelId);
	return <div className="grid gap-5 xl:grid-cols-[minmax(360px,0.7fr)_minmax(0,1.3fr)]"><div className="space-y-5"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Bot className="size-5" /> Create private tutor</CardTitle><CardDescription>Only this tutor receives the selected library. Other agents remain blocked.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="space-y-2"><Label>Name</Label><Input value={name} onChange={(event) => setName(event.target.value)} /></div><div className="space-y-2"><Label>Private library</Label><Select value={libraryId} onValueChange={setLibraryId}><SelectTrigger className="w-full"><SelectValue placeholder="Choose library" /></SelectTrigger><SelectContent>{libraries.data?.map((library) => <SelectItem value={library.id} key={library.id}>{library.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Local model</Label><Select value={modelId} onValueChange={setModelId}><SelectTrigger className="w-full"><SelectValue placeholder="Choose model" /></SelectTrigger><SelectContent>{models.data?.map((model) => <SelectItem value={model.id} key={model.id}>{model.providerLabel} · {model.displayName}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Teaching style</Label><Select value={style} onValueChange={(value) => setStyle(value as typeof style)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="step-by-step">Step by step</SelectItem><SelectItem value="socratic">Socratic</SelectItem><SelectItem value="direct">Direct</SelectItem><SelectItem value="exam-prep">Exam preparation</SelectItem></SelectContent></Select></div><Button className="w-full" onClick={() => selectedModel && create.mutate({ name, libraryIds: [libraryId], runtimeId: selectedModel.providerId, model: selectedModel.model, teachingStyle: style, localOnly: true })} disabled={!selectedModel || !libraryId || !name.trim() || create.isPending}>Create local tutor</Button></CardContent></Card><Card><CardHeader><CardTitle className="text-base">Your tutors</CardTitle></CardHeader><CardContent className="space-y-2">{agents.data?.map((agent) => <button type="button" key={agent.id} onClick={() => setSelectedAgentId(agent.id)} className={`w-full rounded-lg border p-3 text-left ${selectedAgentId === agent.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}><div className="flex justify-between"><span className="font-medium text-sm">{agent.name}</span>{statusBadge(agent.status)}</div><p className="mt-1 text-xs text-muted-foreground">{agent.runtimeId} · {agent.model} · {agent.teachingStyle}</p><p className="mt-1 text-xs text-muted-foreground">{agent.libraryIds.length} private library access grant(s)</p></button>)}{!agents.data?.length && <p className="text-sm text-muted-foreground">No tutors yet.</p>}</CardContent></Card></div><Card className="min-h-[680px]"><CardHeader><CardTitle className="flex items-center gap-2"><BookOpen className="size-5 text-primary" /> Learn from your books</CardTitle><CardDescription>Ask questions, request a lesson, create a quiz, or generate a study guide with citations from the assigned books.</CardDescription></CardHeader><CardContent className="flex min-h-0 flex-1 flex-col gap-4"><div className="grid gap-3 md:grid-cols-[1fr_180px]"><Select value={selectedAgentId} onValueChange={setSelectedAgentId}><SelectTrigger className="w-full"><SelectValue placeholder="Choose tutor" /></SelectTrigger><SelectContent>{agents.data?.map((agent) => <SelectItem value={agent.id} key={agent.id}>{agent.name}</SelectItem>)}</SelectContent></Select><Select value={mode} onValueChange={(value) => setMode(value as BookMode)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="answer">Answer</SelectItem><SelectItem value="teach">Teach</SelectItem><SelectItem value="quiz">Quiz</SelectItem><SelectItem value="study-guide">Study guide</SelectItem></SelectContent></Select></div><Textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Teach me the most important ideas about JavaScript data structures from my assigned books." className="min-h-28" /><Button onClick={() => ask.mutate({ agentProfileId: selectedAgentId, question, mode, safetyMode: "review" })} disabled={!selectedAgentId || !question.trim() || ask.isPending}><MessageSquareText className="size-4" /> {ask.isPending ? "Tutor is reading…" : "Ask tutor"}</Button><Separator />{answer ? <ScrollArea className="max-h-[420px] pr-4"><MarkdownRenderer content={answer} />{citations.length > 0 && <div className="mt-6 rounded-lg bg-muted/50 p-4"><p className="text-sm font-medium">Book citations</p><ul className="mt-2 space-y-1 text-sm text-muted-foreground">{citations.map((citation) => <li key={citation}>• {citation}</li>)}</ul></div>}</ScrollArea> : <EmptyState icon={BookOpen} title="Your private tutor is ready" description="Choose a tutor and ask a question. Only the books assigned to that tutor can be retrieved." />}</CardContent></Card></div>;
}

function ApprovalsTab() {
	const utils = electronTrpc.useUtils();
	const approvals = electronTrpc.agentKernel.approvals.useQuery(undefined, { refetchInterval: 1800 });
	const resolve = electronTrpc.agentKernel.resolveApproval.useMutation({
		onSuccess: () => { void utils.agentKernel.approvals.invalidate(); toast.success("Approval decision saved"); },
	});
	const pending = approvals.data?.filter((item) => item.status === "pending") ?? [];
	return <div className="space-y-5"><div className="grid gap-4 md:grid-cols-3"><StatCard label="Pending" value={pending.length} icon={Clock3} description="Actions waiting for your decision" /><StatCard label="Approved" value={approvals.data?.filter((item) => item.status === "approved").length ?? 0} icon={CheckCircle2} description="Actions explicitly allowed" /><StatCard label="Denied" value={approvals.data?.filter((item) => item.status === "denied").length ?? 0} icon={XCircle} description="Actions blocked by you" /></div><div className="space-y-3">{approvals.data?.map((approval) => <Card key={approval.id} className="gap-4 py-4"><CardContent className="px-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><ShieldCheck className="size-4" /><span className="font-medium">{approval.operation.category}</span>{statusBadge(approval.status)}</div><p className="mt-2 text-sm text-muted-foreground">{approval.decision.reason}</p>{approval.operation.target && <p className="mt-2 rounded bg-muted px-2 py-1 font-mono text-xs">{approval.operation.target}</p>}{approval.operation.command && <p className="mt-2 rounded bg-muted px-2 py-1 font-mono text-xs">{approval.operation.command}</p>}<p className="mt-2 text-xs text-muted-foreground">Requested by {approval.operation.agentId} · {formatDate(approval.requestedAt)} · risk {approval.decision.riskLevel}</p></div>{approval.status === "pending" && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => resolve.mutate({ id: approval.id, approved: false, resolvedBy: "desktop-user" })}>Deny</Button><Button size="sm" onClick={() => resolve.mutate({ id: approval.id, approved: true, resolvedBy: "desktop-user" })}>Approve once</Button></div>}</div></CardContent></Card>)}{!approvals.data?.length && <EmptyState icon={ShieldCheck} title="No approval requests" description="Sensitive actions such as deleting files, sending messages, or publishing packages will appear here." />}</div></div>;
}

function SetupTab() {
	const providers = electronTrpc.agentKernel.localModelProviders.useQuery(undefined, { refetchInterval: 5000 });
	const libraries = electronTrpc.agentKernel.bookLibraries.useQuery();
	const tutors = electronTrpc.agentKernel.knowledgeAgents.useQuery();
	const runtimes = electronTrpc.agentKernel.runtimeHealth.useQuery();
	const openUrl = electronTrpc.external.openUrl.useMutation();
	const checklist = [
		{ label: "CHRISTINA desktop application", done: true, detail: "Installed by the Windows setup program" },
		{ label: "Local model provider", done: Boolean(providers.data?.providers.some((provider) => provider.health.available)), detail: "Ollama or LM Studio is running" },
		{ label: "Local model downloaded", done: Boolean(providers.data?.providers.some((provider) => provider.modelCount > 0)), detail: "At least one model is available" },
		{ label: "Private book library", done: Boolean(libraries.data?.length), detail: "A local or external-drive folder is indexed" },
		{ label: "Private tutor", done: Boolean(tutors.data?.length), detail: "A local agent has exclusive book access" },
	];
	const completed = checklist.filter((item) => item.done).length;
	return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="size-5 text-primary" /> First-run setup</CardTitle><CardDescription>Everything after the app installation can be completed from this interface—no PowerShell commands are required.</CardDescription></CardHeader><CardContent className="space-y-4"><div><div className="mb-2 flex justify-between text-sm"><span>{completed} of {checklist.length} steps complete</span><span>{Math.round((completed / checklist.length) * 100)}%</span></div><Progress value={(completed / checklist.length) * 100} /></div>{checklist.map((item, index) => <div key={item.label} className="flex items-center gap-3 rounded-lg border p-4">{item.done ? <CheckCircle2 className="size-5 text-emerald-500" /> : <div className="flex size-5 items-center justify-center rounded-full border text-[10px] text-muted-foreground">{index + 1}</div>}<div><p className="font-medium text-sm">{item.label}</p><p className="text-xs text-muted-foreground">{item.detail}</p></div></div>)}<div className="flex flex-wrap gap-2 pt-2"><Button onClick={() => openUrl.mutate("https://ollama.com/download/windows")}><Download className="size-4" /> Install Ollama</Button><Button variant="outline" onClick={() => openUrl.mutate("https://lmstudio.ai/download")}><Download className="size-4" /> Install LM Studio</Button></div></CardContent></Card><div className="space-y-5"><Card><CardHeader><CardTitle className="text-base">Runtime health</CardTitle></CardHeader><CardContent className="space-y-2">{runtimes.data?.map((runtime) => <div key={runtime.id} className="flex items-center justify-between rounded-lg border p-3"><span className="text-sm font-medium">{runtime.id}</span>{statusBadge(runtime.health.available ? "healthy" : "unavailable")}</div>)}</CardContent></Card><Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="size-4 text-amber-500" /> Privacy defaults</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground"><p>• Private book tutors run locally by default.</p><p>• Unassigned agents cannot retrieve private book passages.</p><p>• Destructive and external actions require approval.</p><p>• Original book files remain untouched.</p></CardContent></Card></div></div>;
}

export function ChristinaStudio() {
	return (
		<div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background">
			<div className="border-b bg-gradient-to-r from-primary/10 via-background to-background px-6 py-5">
				<div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
					<div><div className="flex items-center gap-2"><div className="rounded-xl bg-primary p-2 text-primary-foreground"><BrainCircuit className="size-5" /></div><div><h1 className="text-xl font-semibold">CHRISTINA Command Centre</h1><p className="text-sm text-muted-foreground">Multi-agent orchestration, local models, and private book tutors</p></div></div></div>
					<Badge variant="outline" className="hidden sm:inline-flex">Local-first · Private by design</Badge>
				</div>
			</div>
			<ScrollArea className="flex-1">
				<div className="mx-auto max-w-[1600px] p-6">
					<Tabs defaultValue="orchestrator" className="gap-5">
						<TabsList className="h-auto w-full justify-start overflow-x-auto p-1 sm:w-fit">
							<TabsTrigger value="orchestrator"><BrainCircuit /> Orchestrator</TabsTrigger>
							<TabsTrigger value="models"><Bot /> Local Models</TabsTrigger>
							<TabsTrigger value="libraries"><Library /> Libraries</TabsTrigger>
							<TabsTrigger value="tutors"><BookOpen /> Tutors</TabsTrigger>
							<TabsTrigger value="approvals"><ShieldCheck /> Approvals</TabsTrigger>
							<TabsTrigger value="setup"><Sparkles /> Setup</TabsTrigger>
						</TabsList>
						<TabsContent value="orchestrator"><OrchestratorTab /></TabsContent>
						<TabsContent value="models"><ModelsTab /></TabsContent>
						<TabsContent value="libraries"><LibrariesTab /></TabsContent>
						<TabsContent value="tutors"><TutorsTab /></TabsContent>
						<TabsContent value="approvals"><ApprovalsTab /></TabsContent>
						<TabsContent value="setup"><SetupTab /></TabsContent>
					</Tabs>
				</div>
			</ScrollArea>
		</div>
	);
}
