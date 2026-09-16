import DynamicIcon from "@/helpers/DynamicIcon";
import { humanize } from "@/lib/utils/textConverter";

const HomapageFeature = ({ feature_list }) => {
  return (
    <div className="key-feature-grid mt-10 grid grid-cols-2 gap-7 md:grid-cols-3 xl:grid-cols-4">
      {feature_list.map((item, i) => {
        return (
          <div
            key={i}
            className="rounded-lg bg-white p-5 shadow-lg"
          >
            {/* 标题行：小图标 + 标题 同一行 */}
            <div className="flex items-center space-x-2">
              <DynamicIcon
                icon={item.icon}
                className="h-5 w-5 shrink-0 text-primary"
              />
              <h3 className="h4 text-xl lg:text-2xl">{item.title}</h3>
            </div>

            {/* 描述行：前面加小圆点 */}
            <p className="mt-3 flex items-start text-text">
              <span className="mr-2 mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>{item.content}</span>
            </p>
          </div>
        );
      })}
    </div>
  );
};

export default HomapageFeature;
