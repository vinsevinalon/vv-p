const Header = () => {
    return (
        <header className="border-b-[3px] md:border-b-[4px] border-[#1A1A1A] p-4 md:p-6 flex flex-col sm:flex-row justify-between items-center bg-white gap-4 md:gap-0">
            <div className="text-xl md:text-2xl font-black bg-[#1A1A1A] text-white px-3 py-1 cursor-default select-none transform sm:-rotate-1 shadow-[4px_4px_0px_0px_#4ECDC4]">
                VINSE_V
            </div>
            <nav className="flex gap-4 md:gap-8 text-xs md:text-sm font-bold items-center font-mono">
                <a href="#work" className="hover:line-through decoration-[#FF6B6B] decoration-[3px] md:decoration-4">PROJECTS</a>
                <a href="#" className="hover:line-through decoration-[#4ECDC4] decoration-[3px] md:decoration-4">LOGS</a>
                <div className="bg-[#4ECDC4] text-[#1A1A1A] px-3 md:px-4 py-1 text-[10px] md:text-xs border-[2px] border-[#1A1A1A] shadow-[2px_2px_0px_0px_#1A1A1A]">
                    TERMINAL_ACTIVE
                </div>
            </nav>
        </header>
    );
};

export default Header;

