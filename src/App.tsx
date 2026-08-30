import Header from './components/Header';
import Hero from './components/Hero';
import SkyBackground from './components/SkyBackground';

function App() {
    return (
        <>
            <SkyBackground />
            <div className="min-h-dvh w-full overflow-x-hidden px-3 py-3 font-sans text-white sm:px-5 sm:py-5 lg:px-8 lg:py-8">
                <div className="mx-auto flex min-h-[calc(100dvh-1.5rem)] w-full max-w-6xl flex-col bg-black/10 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] backdrop-blur-[1px] sm:min-h-[calc(100dvh-2.5rem)] md:shadow-[8px_8px_0px_0px_rgba(26,26,26,1)] lg:min-h-[calc(100dvh-4rem)]">
                    <Header />
                    <main className="flex min-h-0 flex-grow flex-col">
                        <Hero />
                    </main>

                    <footer className="flex flex-col items-start gap-2 p-4 font-mono text-[10px] uppercase leading-tight tracking-widest sm:flex-row sm:items-center sm:justify-between sm:gap-6 md:p-6">
                        <div className="max-w-full break-words">Built with raw code and too much caffeine</div>
                        <div className="max-w-full break-words">{new Date().getFullYear()} VV.TERMINAL</div>
                    </footer>
                </div>
            </div>
        </>
    );
}

export default App;
