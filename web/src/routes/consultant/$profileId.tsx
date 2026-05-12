import { createFileRoute, Link } from "@tanstack/react-router";
import { useConsultantProfileQuery } from "@/hooks/useConsultants";
import { MapPin, BadgeCheck, User, ArrowLeft } from "lucide-react";
import { Button } from "@/ui/button";
import { useAuthStore } from "@/stores/authStore";

export const Route = createFileRoute("/consultant/$profileId")({
  component: ConsultantProfile,
});

function ConsultantProfile() {
  const { profileId } = Route.useParams();
  const { data: profile, isLoading, error } = useConsultantProfileQuery(profileId);
  const { user } = useAuthStore();
  const isOwner = user?.id === profileId;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 pt-24">
        <div className="max-w-5xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-40 bg-gray-200 rounded-2xl w-full"></div>
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              <div className="lg:col-span-1 h-96 bg-white rounded-2xl border border-gray-100"></div>
              <div className="lg:col-span-3 h-96 bg-white rounded-2xl border border-gray-100"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center pt-24">
        <div className="text-center bg-white p-12 rounded-3xl shadow-sm border border-gray-100 max-w-md w-full">
          <User className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Consultant not found</h2>
          <p className="text-gray-600 mb-6">The profile you are looking for might have been removed or does not exist.</p>
          <Link
            to="/consultant/browse"
            className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-xl text-white bg-primary hover:bg-primary/90 transition-colors w-full"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Browse
          </Link>
        </div>
      </div>
    );
  }

  const fullName = profile.display_name || `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || "Consultant";
  const initial = fullName.charAt(0).toUpperCase();

  const currentTime = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) + " local time";

  return (
    <>
      <div className="min-h-screen bg-white pb-12 pt-28 px-4 sm:px-6 lg:px-8">
      <div className="max-w-[1100px] mx-auto">
        
        {/* Navigation */}
        <div className="mb-4">
          <Link
            to="/consultant/browse"
            className="inline-flex items-center text-sm font-medium text-primary hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Browse
          </Link>
        </div>

        {/* Header Section (Upwork Style - Clean, White, No Gradient) */}
        <div className="bg-white rounded-t-2xl border border-gray-200 p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between mb-0">
          
          <div className="flex items-center gap-6 w-full sm:w-auto">
            {/* Avatar */}
            <div className="relative shrink-0">
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={fullName}
                  className="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover border border-gray-200"
                />
              ) : (
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-primary flex items-center justify-center text-white text-3xl font-bold">
                  {initial}
                </div>
              )}
              {/* Online indicator dot - static for UI purposes right now */}
              <div className="absolute top-1 left-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white"></div>
            </div>

            {/* Basic Info */}
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 leading-tight">
                  {fullName}
                </h1>
                {profile.is_consultant_verified && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                    <BadgeCheck className="w-3.5 h-3.5 shrink-0" />
                    Verified Consultant
                  </span>
                )}
              </div>
              
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <MapPin className="w-4 h-4 text-gray-400" />
                {profile.city || profile.country ? (
                  <span>{profile.city ? `${profile.city}, ` : ''}{profile.country}</span>
                ) : (
                  <span>Location not set</span>
                )}
                <span className="text-gray-400 mx-1">–</span>
                <span>{currentTime}</span>
              </div>
            </div>
          </div>

          {/* Top Right Actions */}
          <div className="flex items-center gap-3 mt-4 sm:mt-0 w-full sm:w-auto">
            {isOwner ? (
              <Button 
                onClick={() => {
                  window.location.href = `/profile/${profile.id}`;
                }} 
                variant="outlined" 
                className="w-full sm:w-auto text-primary border-primary hover:bg-primary/10 font-medium rounded-full px-6 transition-colors cursor-pointer"
              >
                Profile settings
              </Button>
            ) : (
              <>
                 <Button variant="outlined" className="w-full sm:w-auto text-primary border-primary hover:bg-primary/10 font-medium rounded-full px-6 transition-colors shadow-[0_0_0_1px_var(--color-primary)] hover:shadow-[0_0_0_1px_var(--color-primary)] cursor-pointer">
                    Save
                 </Button>
                 <Button className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-white font-medium rounded-full px-8 transition-colors cursor-pointer">
                    Hire Now
                 </Button>
              </>
            )}
          </div>
        </div>

        {/* Main 2-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-4 border-x border-b border-gray-200 rounded-b-2xl overflow-hidden bg-white">
          
          {/* LEFT SIDEBAR (Col 1) */}
          <div className="lg:col-span-1 border-r border-gray-200 bg-white">
            
            {/* Availability Badge Mock */}
            <div className="p-6 border-b border-gray-200 bg-primary/5">
               <div className="flex gap-2">
                  <div className="mt-1"><BadgeCheck className="w-4 h-4 text-primary" /></div>
                  <div>
                     <h3 className="font-semibold text-gray-900 text-sm">Top Rated Consultant</h3>
                     <p className="text-xs text-gray-600 mt-1">Clients highly rate this professional for their expertise.</p>
                  </div>
               </div>
            </div>

            {/* Contact Information */}
            <div className="p-6 border-b border-gray-200">
               <h3 className="font-semibold text-gray-900 text-lg mb-4">Direct Context</h3>
               <div className="space-y-4">
                  <div>
                    <p className="text-gray-500 text-sm mb-0.5">Email address</p>
                    {profile.email ? (
                       <a href={`mailto:${profile.email}`} className="text-primary hover:underline text-sm font-medium break-all block">
                         {profile.email}
                       </a>
                    ) : (
                       <p className="text-gray-400 text-sm italic">Hidden by user</p>
                    )}
                  </div>
                  <div>
                    <p className="text-gray-500 text-sm mb-0.5">Phone number</p>
                    {profile.phone_number ? (
                       <a href={`tel:${profile.phone_number}`} className="text-gray-900 hover:text-primary text-sm font-medium break-all block">
                         {profile.phone_number}
                       </a>
                    ) : (
                      <p className="text-gray-400 text-sm italic">Not provided</p>
                    )}
                  </div>
               </div>
            </div>

            {/* Stats block */}
            <div className="p-6">
               <h3 className="font-semibold text-gray-900 text-lg mb-4">Activity</h3>
               <div className="space-y-3 text-sm">
                 <div className="flex justify-between">
                   <span className="text-gray-600">Response time</span>
                   <span className="font-medium text-gray-900">&lt; 24 hrs</span>
                 </div>
                 <div className="flex justify-between">
                   <span className="text-gray-600">Projects completed</span>
                   <span className="font-medium text-gray-900">0</span>
                 </div>
               </div>
            </div>

          </div>

          {/* RIGHT MAIN CONTENT (Col 3) */}
          <div className="lg:col-span-3 bg-white">
            
            {/* Bio/Overview Section */}
            <div className="p-6 sm:p-8 border-b border-gray-200">
              <div className="flex items-start justify-between mb-6">
                <div className="max-w-xl">
                  {/* Title (Headline) */}
                  <h2 className="text-2xl font-bold text-gray-900 mb-2 leading-tight">
                    Professional Technology Expert & Consultant
                  </h2>
                </div>
                
                {/* Actions (Hourly Rate) */}
                <div className="flex items-center gap-4 shrink-0 mt-1">
                   <div className="text-lg font-medium text-gray-900">
                     $50.00/hr
                   </div>
                </div>
              </div>

              {/* Bio Content */}
              <div className="prose max-w-none text-gray-800 text-[15px] leading-relaxed relative">
                {profile.bio ? (
                  <>
                    <p className="whitespace-pre-line">{profile.bio}</p>
                    {profile.bio.length > 300 && (
                      <button className="text-primary font-medium hover:underline mt-2">more</button>
                    )}
                  </>
                ) : (
                  <p className="text-gray-400 italic">This consultant hasn't written an overview yet.</p>
                )}
              </div>
            </div>

            {/* Skills Section */}
            <div className="p-6 sm:p-8 border-b border-gray-200">
               <div className="mb-6">
                 <h2 className="text-2xl font-bold text-gray-900">Skills</h2>
               </div>
               
               {profile.skills && profile.skills.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {profile.skills.map((skill, index) => (
                    <span
                      key={index}
                      className="px-4 py-1.5 bg-gray-100/80 text-gray-700 text-sm font-medium rounded-full cursor-pointer hover:bg-gray-200 hover:text-primary transition-colors"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-sm">No specific skills listed.</p>
              )}
            </div>

            {/* Empty Portfolio Mock */}
            <div className="p-6 sm:p-8">
               <div className="mb-6">
                 <h2 className="text-2xl font-bold text-gray-900">Portfolio</h2>
               </div>
               
               <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed border-gray-200 rounded-xl text-center">
                  <div className="w-16 h-16 bg-gray-50 rounded-full flex flex-col items-center justify-center mb-4">
                     <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                     </svg>
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-1">No Portfolio Items</h3>
                  <p className="text-gray-500 text-sm max-w-sm">This consultant hasn't added any portfolio projects to their profile yet.</p>
               </div>
            </div>

           </div>
         </div>
       </div>
      </div>
    </>
  );
}
