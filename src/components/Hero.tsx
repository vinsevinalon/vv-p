const Hero = () => {
    return (
        <section className="flex min-h-[calc(100dvh-10.75rem)] flex-1 items-end p-5 sm:min-h-[calc(100dvh-11.5rem)] sm:p-8 md:min-h-[calc(100dvh-13rem)] md:p-12">
            <div className="w-full max-w-4xl space-y-6 sm:space-y-8 md:space-y-10">
                <div className="inline-block max-w-full bg-[#1A1A1A] px-3 py-1 font-mono text-[10px] font-bold leading-tight text-white sm:px-4 sm:py-1.5 sm:text-xs">
                    FULL STACK ENGINEER
                </div>
                <h1 className="max-w-[8ch] text-5xl font-black uppercase leading-[0.86] tracking-normal text-white sm:max-w-none sm:text-7xl md:text-8xl lg:text-9xl">
                    Raw Code <br />
                    Hard Wares
                </h1>
                <div className="max-w-2xl space-y-4 sm:space-y-5 md:space-y-6">
                    <p className="text-base font-bold leading-snug sm:text-lg md:text-xl">
                        A decade of breaking things and building better ones.
                        Redefining the limits of web and e-commerce.
                    </p>
                    <div className="flex max-w-full flex-wrap gap-2 font-mono text-[10px] uppercase leading-tight sm:gap-3 sm:text-xs">
                        <span className="max-w-full break-words px-2 py-1 text-white sm:px-3">Web Application</span>
                        <span className="max-w-full break-words px-2 py-1 text-white sm:px-3">E-Commerce</span>
                        <span className="max-w-full break-words px-2 py-1 text-white sm:px-3">Agentic Engineering</span>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default Hero;
