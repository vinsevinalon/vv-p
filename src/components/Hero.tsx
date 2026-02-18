const Hero = () => {
    return (
        <section className="p-6 md:p-12 border-b-[3px] md:border-b-[4px] border-[#1A1A1A]">
            <div className="space-y-6 md:space-y-10">
                <div className="text-[10px] md:text-xs inline-block border-[2px] border-[#1A1A1A] px-3 md:px-4 py-1 md:py-1.5 bg-[#FFE66D] font-mono font-bold shadow-[2px_2px_0px_0px_#1A1A1A] md:shadow-[3px_3px_0px_0px_#1A1A1A]">
                    &gt; AUTH_REQ: SHOPIFY_ARCHITECT
                </div>
                <h1 className="text-5xl sm:text-7xl md:text-9xl lg:text-[10rem] font-black uppercase leading-[0.9] md:leading-[0.85] tracking-tighter break-all sm:break-normal">
                    RAW_CODE <br />
                    HARD_WARES.
                </h1>
                <div className="max-w-xl space-y-4 md:space-y-6">
                    <p className="text-lg md:text-xl font-bold leading-tight">
                        [DESCRIPTION] I break themes and build better ones. Fullstack
                        Shopify engineering with zero fluff.
                    </p>
                    <div className="flex flex-wrap gap-2 md:gap-3 text-[10px] md:text-xs uppercase font-mono">
                        <span className="bg-[#FF6B6B] text-white px-2 md:px-3 py-1 border-[2px] border-[#1A1A1A]">Liquid</span>
                        <span className="bg-[#4ECDC4] text-[#1A1A1A] px-2 md:px-3 py-1 border-[2px] border-[#1A1A1A]">GraphQL</span>
                        <span className="bg-[#FFE66D] text-[#1A1A1A] px-2 md:px-3 py-1 border-[2px] border-[#1A1A1A]">Node</span>
                        <span className="bg-[#1A1A1A] text-white px-2 md:px-3 py-1 border-[2px] border-[#1A1A1A]">React</span>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default Hero;
