import { createFileRoute } from "@tanstack/react-router";
import { ChristinaStudio } from "renderer/screens/christina/ChristinaStudio";

export const Route = createFileRoute("/_authenticated/_dashboard/christina/")({
	component: ChristinaPage,
});

function ChristinaPage() {
	return <ChristinaStudio />;
}
