import DynamicIcon from "@/helpers/DynamicIcon";

const Projects = ({ projects }) => {
  return (
    <div className="col-12 ">
      <div className="row">
        {projects.map((item, i) => {
          return (
            <div className="lg:col-6" key={`item-${i}`}>
              <div
                className={`rounded-lg bg-body px-6 py-8 lg:mt-6 ${
                  projects.length - 1 === i ? "mb-0" : "mb-6"
                }`}
              >
                {/* 标题行：小图标 + 标题 同一行 */}
                <div className="flex items-center space-x-3">
                  <span className="inline-flex shrink-0 text-primary [&>svg]:h-6 [&>svg]:w-6">
                    <DynamicIcon icon={item.icon} className="font-semibold" />
                  </span>
                  <h3 className="h5 font-primary">{item.title}</h3>
                </div>

                {/* 描述行：前面加小圆点 */}
                <p className="mt-4 flex items-start text-text">
                  <span className="mr-3 mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{item.content}</span>
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Projects;
