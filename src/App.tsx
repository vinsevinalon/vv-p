import Header from './components/Header';
import LoadingScreen from './components/LoadingScreen';
import Hero from './components/Hero';
import SkyBackground from './components/SkyBackground';
import ThemeToggle from './components/ThemeToggle';

function App() {
    return (
        <>
            <SkyBackground />
            <LoadingScreen />
            <ThemeToggle />
            <div className="min-h-dvh w-full overflow-x-hidden px-3 py-3 font-sans text-white sm:px-5 sm:py-5 lg:px-8 lg:py-8">
                <div className="mx-auto flex min-h-[calc(100dvh-1.5rem)] w-full max-w-6xl flex-col sm:min-h-[calc(100dvh-2.5rem)] lg:min-h-[calc(100dvh-4rem)]">
                    <Header />
                    <main className="flex min-h-0 flex-grow flex-col">
                        <Hero />
                    </main>
                </div>
            </div>
        </>
    );
}

export default App;
