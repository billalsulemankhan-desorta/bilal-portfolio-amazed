import { About, TechMarquee } from "./components/About";
import { AppointmentSection } from "./components/AppointmentSection";
import { CustomCursor } from "./components/CustomCursor";
import { DevPanel } from "./components/DevPanel";
import { DynamicSections } from "./components/DynamicSections";
import { Experiences } from "./components/Experiences";
import { Footer } from "./components/Footer";
import { Hero } from "./components/Hero";
import { IndexTable } from "./components/IndexTable";
import { Metrics } from "./components/Metrics";
import { MusicPlayer } from "./components/MusicPlayer";
import { Nav, ScrollProgress } from "./components/Nav";
import { ScrollGuide } from "./components/ScrollGuide";
import { TypeIntro } from "./components/TypeIntro";
import { Work } from "./components/Work";
import { ContentProvider, useContent } from "./context/ContentContext";
import { useReveal } from "./hooks/useReveal";

function Portfolio() {
  const { content } = useContent();
  useReveal(JSON.stringify(content));

  return (
    <div className="relative min-h-screen bg-ink">
      <a
        href="#main"
        className="fixed left-4 top-4 z-[100] -translate-y-24 bg-accent px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>

      <ScrollProgress />
      <Nav />
      <ScrollGuide />

      <main id="main">
        <Hero />
        <Metrics />
        <Work />
        <TypeIntro />
        <IndexTable />
        <Experiences />
        <About />
        <DynamicSections />
        <TechMarquee />
        <AppointmentSection />
      </main>

      <Footer />
      <CustomCursor />
      <MusicPlayer />
      <DevPanel />
    </div>
  );
}

export default function App() {
  return (
    <ContentProvider>
      <Portfolio />
    </ContentProvider>
  );
}
