import Header from './components/Header';
import Hero from './components/Hero';
import Projects from './components/Projects';

function App() {
    return (
        <div className="min-h-screen bg-[#FDFCF0] text-[#1A1A1A] font-sans p-2 md:p-8">
            <div className="max-w-6xl mx-auto border-[3px] md:border-[4px] border-[#1A1A1A] min-h-[calc(100vh-1rem)] md:min-h-[calc(100vh-4rem)] flex flex-col shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:shadow-[8px_8px_0px_0px_rgba(26,26,26,1)]">
                <Header />
                <main className="flex-grow flex flex-col">
                    <Hero />
                    <Projects />

                    <section className="border-t-[3px] md:border-t-[4px] border-[#1A1A1A] p-6 md:p-8 bg-[#FF6B6B] text-white">
                        <h2 className="text-3xl md:text-4xl font-black mb-6 md:mb-8 underline tracking-tight">SYSTEM_STATUS: OK</h2>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 text-xs md:text-sm font-mono">
                            <div className="p-4 border-[2px] border-white space-y-1 md:space-y-2 bg-[#1A1A1A]/10">
                                <div className="font-bold underline">Uptime</div>
                                <div>99.99%</div>
                            </div>
                            <div className="p-4 border-[2px] border-white space-y-1 md:space-y-2 bg-[#1A1A1A]/10">
                                <div className="font-bold underline">Lines Changed</div>
                                <div>4.2M+</div>
                            </div>
                            <div className="p-4 border-[2px] border-white space-y-1 md:space-y-2 bg-[#1A1A1A]/10">
                                <div className="font-bold underline">Coffee_Input</div>
                                <div>Infinite</div>
                            </div>
                        </div>
                    </section>
                </main>

                <footer className="border-t-[3px] md:border-t-[4px] border-[#1A1A1A] p-4 md:p-6 flex flex-col md:flex-row justify-between items-center text-[8px] md:text-[10px] uppercase font-mono tracking-widest bg-[#4ECDC4]/10 gap-4 md:gap-0">
                    <div>Built with raw code and too much caffeine</div>
                    <div>© {new Date().getFullYear()} VV.TERMINAL</div>
                </footer>
            </div>
        </div>
    );
}

export default App;
