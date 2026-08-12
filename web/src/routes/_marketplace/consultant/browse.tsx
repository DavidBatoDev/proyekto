import { createFileRoute, Link } from "@tanstack/react-router";
import { useConsultantsQuery } from "@/hooks/useConsultants";
import { Search, MapPin, Briefcase } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_marketplace/consultant/browse")({
  component: BrowseConsultants,
});

function BrowseConsultants() {
  const { data: consultants, isLoading, error } = useConsultantsQuery();
  const [searchQuery, setSearchQuery] = useState("");

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 pt-24">
        <div className="max-w-6xl mx-auto">
          <div className="animate-pulse space-y-8">
            <div className="h-12 w-64 bg-gray-200 rounded-lg"></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-64 bg-white rounded-2xl shadow-sm border border-gray-100"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center pt-24">
        <div className="text-center bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Error loading consultants</h2>
          <p className="text-gray-600">Please try again later.</p>
        </div>
      </div>
    );
  }

  const filteredConsultants = consultants?.filter(
    (c) =>
      c.display_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.first_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.last_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.skills?.some((s) => s.toLowerCase().includes(searchQuery.toLowerCase()))
  ) || [];

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 mt-16">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">Browse Consultants</h1>
            <p className="mt-2 text-lg text-gray-600 max-w-2xl">
              Find and connect with top-tier verified consultants to elevate your projects.
            </p>
          </div>
          
          <div className="relative max-w-md w-full">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              placeholder="Search by name or skills..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-xl leading-5 bg-white placeholder-gray-500 focus:outline-hidden focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition duration-150 ease-in-out shadow-xs h-full"
            />
          </div>
        </div>

        {filteredConsultants.length === 0 ? (
          <div className="text-center bg-white p-16 rounded-2xl shadow-sm border border-gray-200">
            <Briefcase className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900">No consultants found</h3>
            <p className="mt-1 text-gray-500">We couldn't find anyone matching your search criteria.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredConsultants.map((consultant) => {
              const fullName = consultant.display_name || `${consultant.first_name || ""} ${consultant.last_name || ""}`.trim() || "Consultant";
              const initial = fullName.charAt(0).toUpperCase();

              return (
                <Link
                  key={consultant.id}
                  to="/consultant/$profileId"
                  params={{ profileId: consultant.id }}
                  className="group bg-white rounded-2xl shadow-xs hover:shadow-xl border border-gray-200 transition-all duration-300 overflow-hidden flex flex-col items-start translate-y-0 hover:-translate-y-1"
                >
                  <div className="p-6 flex items-start gap-4 w-full border-b border-gray-100">
                    <div className="relative">
                      {consultant.avatar_url ? (
                        <img
                          src={consultant.avatar_url}
                          alt={fullName}
                          className="w-16 h-16 rounded-full object-cover shadow-sm bg-gray-50"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-full bg-linear-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-2xl font-bold shadow-sm">
                          {initial}
                        </div>
                      )}
                      <span className="absolute bottom-0 right-0 block h-4 w-4 rounded-full bg-green-400 ring-2 ring-white" title="Verified"></span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-bold text-gray-900 truncate group-hover:text-blue-600 transition-colors">
                        {fullName}
                      </h3>
                      
                      {consultant.country && consultant.city && (
                        <div className="flex items-center text-sm text-gray-500 mt-1">
                          <MapPin className="w-3.5 h-3.5 mr-1" />
                          <span className="truncate">{consultant.city}, {consultant.country}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="p-6 grow flex flex-col w-full">
                    {consultant.bio ? (
                      <p className="text-gray-600 text-sm line-clamp-3 mb-4 grow">
                        {consultant.bio}
                      </p>
                    ) : (
                      <p className="text-gray-400 text-sm italic mb-4 grow">
                        No bio provided
                      </p>
                    )}

                    {consultant.skills && consultant.skills.length > 0 && (
                      <div className="mt-auto">
                        <div className="flex flex-wrap gap-2">
                          {consultant.skills.slice(0, 3).map((skill, idx) => (
                            <span
                              key={idx}
                              className="px-2.5 py-1 text-xs font-medium bg-blue-50 text-blue-700 rounded-md border border-blue-100"
                            >
                              {skill}
                            </span>
                          ))}
                          {consultant.skills.length > 3 && (
                            <span className="px-2.5 py-1 text-xs font-medium bg-gray-50 text-gray-600 rounded-md border border-gray-100">
                              +{consultant.skills.length - 3}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
