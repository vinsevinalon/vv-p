const items = [
    { id: '01', title: 'HEAVY_DUTY_THEME', category: 'LIQUID', color: 'hover:bg-[#FF6B6B]' },
    { id: '02', title: 'SECRET_ADMIN_APP', category: 'NODE_JS', color: 'hover:bg-[#4ECDC4]' },
    { id: '03', title: 'CARBON_STORE_FRONT', category: 'HEADLESS', color: 'hover:bg-[#FFE66D]' }
];

const Projects = () => {
    return (
        <section id="work" className="grid grid-cols-1 lg:grid-cols-3 divide-y-[3px] md:divide-y-[4px] lg:divide-y-0 lg:divide-x-[4px] divide-[#1A1A1A] flex-grow">
            {items.map((item) => (
                <div key={item.id} className={`p-6 md:p-10 ${item.color} hover:text-[#1A1A1A] transition-all duration-300 group cursor-crosshair bg-white/20`}>
                    <div className="text-xs md:text-sm font-mono font-bold mb-4 md:mb-6 opacity-40 group-hover:opacity-100 transition-opacity tracking-widest">[EXE_{item.id}]</div>
                    <h3 className="text-3xl sm:text-4xl md:text-5xl font-black mb-8 md:mb-16 tracking-tighter leading-none break-all underline decoration-[3px] md:decoration-4 underline-offset-4 md:underline-offset-8">
                        {item.title}
                    </h3>
                    <div className="font-mono font-bold border-[2px] border-[#1A1A1A] inline-block px-3 py-1 text-[10px] bg-white group-hover:bg-[#1A1A1A] group-hover:text-white transition-colors">
                        TARGET: {item.category}
                    </div>
                </div>
            ))}
        </section>
    );
};

export default Projects;
